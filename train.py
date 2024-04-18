from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.applications.resnet50 import ResNet50
from tensorflow.keras.layers import GlobalAveragePooling2D, Dense
from tensorflow.keras.models import Model
import random
import numpy as np

import warnings
warnings.filterwarnings('ignore', category=UserWarning)

def add_noise(img):
    '''Add random noise to an image'''
    VARIABILITY = 10
    deviation = VARIABILITY*random.random()
    noise = np.random.normal(0, deviation, img.shape)
    img += noise
    np.clip(img, 0., 255.)
    return img

def create_data_generator():
    return ImageDataGenerator(
        rotation_range=45,
        width_shift_range=0.15,
        height_shift_range=0.15,
        shear_range=0.15,
        zoom_range=0.2,
        # horizontal_flip=True,
        fill_mode='nearest',
        # brightness_range=[0.5, 1.1],
        #preprocessing_function=add_noise,
        # validation_split=0.1  # setting 20% of the data for validation
    )

def train_model(data_directory, batch_size=32, epochs=10):
    data_generator = create_data_generator()

    train_generator = data_generator.flow_from_directory(
        data_directory,
        target_size=(224, 224),
        batch_size=batch_size,
        class_mode='categorical',
        subset='training',  # set as training data
        shuffle=True
    )

    # validation_generator = data_generator.flow_from_directory(
    #     data_directory,
    #     target_size=(224, 224),
    #     batch_size=batch_size,
    #     class_mode='categorical',
    #     subset='validation',  # set as validation data
    #     shuffle=True
    # )

    base_model = ResNet50(weights='imagenet', include_top=False, input_shape=(224, 224, 3))
    x = base_model.output
    x = GlobalAveragePooling2D()(x)
    predictions = Dense(train_generator.num_classes, activation='softmax')(x)
    model = Model(inputs=base_model.input, outputs=predictions)

    model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])

    # Set a multiplier for how many times you want to augment each image per epoch
    # augmentation_multiplier = 3

    # Calculate steps per epoch based on the multiplier
    train_steps_per_epoch = (train_generator.samples // batch_size)# * augmentation_multiplier
    # val_steps_per_epoch = (validation_generator.samples // batch_size)# * augmentation_multiplier

    total_train_images = train_generator.samples# * augmentation_multiplier
    # total_val_images = validation_generator.samples# * augmentation_multiplier

    print(f"Total training images (after augmentation): {total_train_images}")
    # print(f"Total validation images (after augmentation): {total_val_images}")
    print(f"Steps per epoch (training): {train_steps_per_epoch}")
    # print(f"Steps per epoch (validation): {val_steps_per_epoch}")

    # Fit the model with the increased steps per epoch
    model.fit(
        train_generator,
        epochs=epochs,
        steps_per_epoch=train_generator.samples // batch_size,
        # validation_data=validation_generator,
        # validation_steps=validation_generator.samples // batch_size
    )


    return model

if __name__ == '__main__':
    data_directory = 'data/db_comic_new'
    model = train_model(data_directory)
    model.save('data/model.keras')
    print("Model saved!")