let serverUrl;

if (window.location.hostname === 'tux.plus') {
    console.log('Serving from aliased server.');
    serverUrl = 'https://tux.plus'; // Assuming you have a route '/capture' set up on tux.plus
} else if (window.location.protocol === 'file:') {
    console.log('Serving from local file system.');
    serverUrl = 'http://127.0.0.1:5000'; // Use this for local testing
} else {
    console.log('Serving from web server.');
    serverUrl = 'https://comicscan.uk.r.appspot.com'; // Default server URL
}

let overlayDecay = 2000;
let overlayTextDecay = 4000;

let responseTimes = [];

const maxWidth = 600;
const maxHeight = 800;

let cvReady = false;
let streamStarted = false;
let videoStream = null;
async function loadOpenCV() {
    if (typeof cv === 'undefined') {
        await import('https://docs.opencv.org/master/opencv.js');
    }
    cv['onRuntimeInitialized'] = () => {
        console.log("OpenCV.js is ready.");
        cvReady = true;
        attemptStartApp();
    };
}

document.addEventListener('DOMContentLoaded', () => {
    loadOpenCV();
});



function attemptStartApp() {
    if (cvReady && streamStarted) {
        startApp();
    }
}

navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => {
        streamStarted = true;
        videoStream = stream; // Save the stream globally
        let tracks = stream.getVideoTracks();
        localStorage.setItem('deviceId', tracks[0].getSettings().deviceId);
        attemptStartApp();
    })
    .catch(error => {
        console.error("Error accessing the webcam", error);
        streamStarted = false;
    });

document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && !streamStarted) {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
                streamStarted = true;
                videoStream = stream;
                video.srcObject = videoStream;
                video.play();
                let tracks = stream.getVideoTracks();
                localStorage.setItem('deviceId', tracks[0].getSettings().deviceId);
            })
            .catch(error => {
                console.error("Error accessing the webcam", error);
                streamStarted = false;
            });
    }
});

document.querySelectorAll('#controlPanel input[type="range"]').forEach(input => {
    input.addEventListener('input', () => {
        const valueDisplay = document.getElementById(input.id + 'Value');
        valueDisplay.textContent = input.value;
    });
});

function getOffset(element) {
    let x = 0;
    let y = 0;
    while (element && !isNaN(element.offsetLeft) && !isNaN(element.offsetTop)) {
        x += element.offsetLeft - element.scrollLeft;
        y += element.offsetTop - element.scrollTop;
        element = element.offsetParent;
    }
    return { top: y, left: x };
}

function adjustCanvas() {
    const video = document.getElementById('webcam');
    const overlayCanvas = document.getElementById('overlayCanvas');
    const navbar = document.querySelector('.navbar');

    const navHeight = navbar.offsetHeight;
    const { left: videoLeft, top: videoTop } = getOffset(video);

    // overlayCanvas.style.top = `${videoTop - navHeight}px`;
    overlayCanvas.style.left = `${videoLeft}px`;
    overlayCanvas.width = video.clientWidth;
    overlayCanvas.height = video.clientHeight;
}

window.addEventListener('resize', adjustCanvas);
document.addEventListener('DOMContentLoaded', adjustCanvas);

function initializeCanvasContextForDrawing(overlayContext) {
    overlayContext.strokeStyle = 'yellow';
    overlayContext.lineWidth = 2;
    overlayContext.shadowColor = 'rgba(255, 255, 0, 0.7)'; // Yellow glow
    overlayContext.shadowBlur = 10;
    overlayContext.shadowOffsetX = 0;
    overlayContext.shadowOffsetY = 0;
}

function detectLargestContourInRegion(x, y, width, height) {
    const video = document.getElementById('webcam');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const region = ctx.getImageData(x, y, width, height);
    let src = cv.matFromImageData(region);
    if (src.empty()) {
        console.log('Source image is empty');
        return null;
    }
    
    let hsv = new cv.Mat();
    let mask = new cv.Mat();

    // Assume these values are set from UI or pre-defined
    const lowHue = parseFloat(document.getElementById('lowHue').value);
    const highHue = parseFloat(document.getElementById('highHue').value);
    const lowSat = parseFloat(document.getElementById('lowSat').value);
    const highSat = parseFloat(document.getElementById('highSat').value);
    const lowVal = parseFloat(document.getElementById('lowVal').value);
    const highVal = parseFloat(document.getElementById('highVal').value);

    const expectedAspectRatio = parseFloat(document.getElementById('aspectRatio').value);
    const aspectRatioTolerance = parseFloat(document.getElementById('aspectRatioTolerance').value);
    const areaPersistence = parseFloat(document.getElementById('areaPersistence').value);

    try {
        cv.cvtColor(src, hsv, cv.COLOR_RGB2HSV);
        let low = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [lowHue, lowSat, lowVal, 0]);
        let high = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [highHue, highSat, highVal, 255]);
        cv.inRange(hsv, low, high, mask);

        if (mask.empty()) {
            console.log('Mask is empty');
            src.delete();
            hsv.delete();
            mask.delete();
            low.delete();
            high.delete();
            return null;
        }

        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let largestContour = {area: 0, rect: null};

        for (let i = 0; i < contours.size(); i++) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt, false);

            if (area > largestContour.area) {
                let rect = cv.boundingRect(cnt);
                let aspectRatio = rect.width / rect.height;

                if (Math.abs(aspectRatio - expectedAspectRatio) < aspectRatioTolerance && area > areaPersistence) {
                    largestContour = {area: area, rect: rect};
                }
            }
        }

        // Cleanup
        src.delete();
        hsv.delete();
        mask.delete();
        low.delete();
        high.delete();
        contours.delete();
        hierarchy.delete();

        if (largestContour.rect) {
            // Add a fixed buffer
            const buffer = 5;
            largestContour.rect.x = Math.max(largestContour.rect.x - buffer, 0);  // Ensure x is not negative
            largestContour.rect.y = Math.max(largestContour.rect.y - buffer, 0);  // Ensure y is not negative
            largestContour.rect.width += 2 * buffer;
            largestContour.rect.height += 2 * buffer;
        
            // Ensure the rectangle does not exceed the canvas size
            largestContour.rect.width = Math.min(largestContour.rect.width, canvas.width - largestContour.rect.x);
            largestContour.rect.height = Math.min(largestContour.rect.height, canvas.height - largestContour.rect.y);
        
            return largestContour.rect;
        }        
    } catch (e) {
        console.error('Error in contour detection:', e);
    }

    return null;
}

function startApp() {
    // Here OpenCV is loaded and the webcam has been accessed
    const video = document.getElementById('webcam');
    if (videoStream) {
        video.srcObject = videoStream;
        video.play();
    }

    function setCheckboxState(checkbox, localStorageKey, postAction = null) {
        const isChecked = JSON.parse(localStorage.getItem(localStorageKey) || 'false');
        checkbox.checked = isChecked;
    
        // Perform any immediate action needed on load
        if (postAction) {
            postAction(isChecked);
        }
    
        checkbox.addEventListener('change', () => {
            localStorage.setItem(localStorageKey, checkbox.checked);
            if (postAction) {
                postAction(checkbox.checked);
            }
        });
    }
    
    function initializeCheckboxes() {
        const invertCameraToggle = document.getElementById('invertCameraToggle');
        const displayVisionToggle = document.getElementById('displayVisionToggle');
        const devOptionsToggle = document.getElementById('devOptionsToggle');
    
        setCheckboxState(invertCameraToggle, 'cameraInverted', (isChecked) => {
            video.style.transform = isChecked ? 'scaleX(-1)' : 'scaleX(1)';
        });
    
        setCheckboxState(displayVisionToggle, 'displayCV', (isChecked) => {
            displayCV = isChecked;
            if (isChecked) {
                startRealTimeDetection();
            } else {
                requestAnimationFrame(() => {
                    const overlayCanvas = document.getElementById('overlayCanvas');
                    const overlayContext = overlayCanvas.getContext('2d');
                    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); 
                });   
            }
        });
    
        setCheckboxState(devOptionsToggle, 'devOptionsVisible', (isChecked) => {
            document.getElementById('devOptions').style.display = isChecked ? 'block' : 'none';
        });
    }

    let startX = 0, startY = 0, endX = 0, endY = 0;
    let isDrawing = false;
    let interactionStartTime = 0;
    const tapThresholdTime = 200; // milliseconds
    const moveThreshold = 10; // pixels

    const overlayCanvas = document.getElementById('overlayCanvas');
    const overlayContext = overlayCanvas.getContext('2d', { willReadFrequently: true });

    function isTapEvent(startTime, endTime, startX, startY, endX, endY) {
        const duration = endTime - startTime;
        const movedDistance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        return duration < tapThresholdTime && movedDistance < moveThreshold;
    }

    overlayCanvas.addEventListener('mousedown', (event) => {
        isDrawing = true;
        startX = event.offsetX;
        startY = event.offsetY;
    });
    
    // Step 2: Draw the selection area
    overlayCanvas.addEventListener('mousemove', (event) => {
        if (isDrawing) {
            drawRectangle(startX, startY, event.offsetX - startX, event.offsetY - startY);
        }
    });
    
    // Step 3: End selection and process area
    overlayCanvas.addEventListener('mouseup', (event) => {
        if (isDrawing) {
            isDrawing = false;
            const selectedWidth = event.offsetX - startX;
            const selectedHeight = event.offsetY - startY;
            processSelectedArea(startX, startY, selectedWidth, selectedHeight);
        }
    });

    overlayCanvas.addEventListener('mouseleave', function(event) {
        if (isDrawing) {
            finishDrawing(event);
        }
    });

    overlayCanvas.addEventListener('touchstart', function(event) {
        if (event.touches.length === 1) { // Only proceed if a single touch point is detected
            const touch = event.touches[0];
            const rect = overlayCanvas.getBoundingClientRect();
            startX = touch.clientX - rect.left;
            startY = touch.clientY - rect.top;
            interactionStartTime = new Date().getTime();
            isDrawing = true;
        }
        event.preventDefault(); // Prevent default touch behavior (like scrolling)
    });
    
    overlayCanvas.addEventListener('touchmove', function(event) {
        if (event.touches.length === 1 && isDrawing) {
            const touch = event.touches[0];
            const rect = overlayCanvas.getBoundingClientRect();
            endX = touch.clientX - rect.left;
            endY = touch.clientY - rect.top;
    
            if (Math.abs(endX - startX) > moveThreshold || Math.abs(endY - startY) > moveThreshold) {
                drawRectangle(startX, startY, endX, endY, document.getElementById('webcam'));
            }
        }
        event.preventDefault(); // Prevent scrolling
    });
    
    overlayCanvas.addEventListener('touchend', function(event) {
        const interactionEndTime = new Date().getTime();
        if (isTapEvent(interactionStartTime, interactionEndTime, startX, startY, endX, endY)) {
            // Simulate a click event if it's a tap
            onVideoClick({ clientX: startX + overlayCanvas.getBoundingClientRect().left, clientY: startY + overlayCanvas.getBoundingClientRect().top });
        } else if (isDrawing) {
            // End the drawing on touch end if it's a drag
            sendAreaToBackend(startX, startY, endX, endY);
        }
        isDrawing = false;
        overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); // Clear after the touch ends
        event.preventDefault();
    });

    function finishDrawing(event) {
        const interactionEndTime = new Date().getTime();
        const rect = overlayCanvas.getBoundingClientRect();
        const scaledStartX = (startX - rect.left) * (video.videoWidth / rect.width);
        const scaledStartY = (startY - rect.top) * (video.videoHeight / rect.height);
        const scaledEndX = (endX - rect.left) * (video.videoWidth / rect.width);
        const scaledEndY = (endY - rect.top) * (video.videoHeight / rect.height);
    
        if (isTapEvent(interactionStartTime, interactionEndTime, startX, startY, endX, endY)) {
            onVideoClick(event);
        } else {
            sendAreaToBackend(scaledStartX, scaledStartY, scaledEndX - scaledStartX, scaledEndY - scaledStartY);
        }
        isDrawing = false;
        overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }    

    function drawRectangle(x, y, width, height) {
        console.log("draw" + x, y, width, height);
        overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayContext.beginPath();
        overlayContext.rect(x, y, width, height);
        overlayContext.stroke();
    }

    function captureVisibleVideoArea() {
        const video = document.getElementById('webcam');
        const overlayCanvas = document.getElementById('overlayCanvas');
        const ctx = overlayCanvas.getContext('2d');
        
        const videoStyle = window.getComputedStyle(video);
        const videoRect = video.getBoundingClientRect();
        const containerRect = video.parentElement.getBoundingClientRect();
    
        // Compute the size and position of the video within the container
        const videoWidthScale = video.videoWidth / parseFloat(videoStyle.width);
        const videoHeightScale = video.videoHeight / parseFloat(videoStyle.height);
        const offsetX = (containerRect.width - videoRect.width) / 2 * videoWidthScale;
        const offsetY = (containerRect.height - videoRect.height) / 2 * videoHeightScale;
        const visibleWidth = videoRect.width * videoWidthScale;
        const visibleHeight = videoRect.height * videoHeightScale;
    
        // Clear the canvas and draw the current visible video area
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        ctx.drawImage(video, offsetX, offsetY, visibleWidth, visibleHeight, 
                      0, 0, overlayCanvas.width, overlayCanvas.height);
        
        const visibleImageDataUrl = overlayCanvas.toDataURL('image/jpeg');
        sendImageToBackend(visibleImageDataUrl);
    }
    

    function processSelectedArea(x, y, width, height) {
        captureVisibleVideoArea(); // Capture the whole visible video area first
    
        const overlayCanvas = document.getElementById('overlayCanvas');
        const ctx = overlayCanvas.getContext('2d');
    
        // Now overlayCanvas contains the whole visible video area
        // Next, we'll clip the selected region
        const imageData = ctx.getImageData(x, y, width, height);
    
        // Create a canvas just for the selected area
        const selectedAreaCanvas = document.createElement('canvas');
        selectedAreaCanvas.width = width;
        selectedAreaCanvas.height = height;
        const selectedAreaCtx = selectedAreaCanvas.getContext('2d');
    
        // Put the image data of the selected area onto the new canvas
        selectedAreaCtx.putImageData(imageData, 0, 0);
    
        // Convert the selected area canvas content to a data URL and send it to the backend
        const selectedAreaDataUrl = selectedAreaCanvas.toDataURL('image/jpeg');
        //sendImageToBackend(selectedAreaDataUrl);
    }    

    function sendAreaToBackend(startX, startY, endX, endY) {
        const video = document.getElementById('webcam');
        const rect = video.getBoundingClientRect();
        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;
    
        const videoX = (startX - rect.left) * scaleX;
        const videoY = (startY - rect.top) * scaleY;
        const videoWidth = Math.abs(endX - startX) * scaleX;
        const videoHeight = Math.abs(endY - startY) * scaleY;
    
        if (videoWidth > 0 && videoHeight > 0) {
            processSelectedArea(videoX, videoY, videoWidth, videoHeight);
        }
    }

    const imageSelector = document.getElementById('imageSelector');
    const loadingIndicator = document.getElementById('loadingIndicator');

    const invertCameraToggle = document.getElementById('invertCameraToggle');
    const displayVisionToggle = document.getElementById('displayVisionToggle');
    const devOptionsToggle = document.getElementById('devOptionsToggle');

    const captureButton = document.getElementById('capture');
    const testButton = document.getElementById('testButton');
    const switchCameraButton = document.getElementById('switchCamera');
    const flashlightToggle = document.getElementById('flashlightToggle');
    const resultsToggle = document.getElementById('resultsToggle');
    const collectionToggle = document.getElementById('collectionToggle');
    const resultsShelf = document.getElementById('resultsShelf');
    const resultsCarousel = document.getElementById('resultsCarousel');

    const navbar = document.querySelector('.navbar');
    const navbarHeight = navbar.offsetHeight;

    // const messageBox = document.getElementById('messageBox');

    let shouldBeInverted = localStorage.getItem('cameraInverted');
    shouldBeInverted = shouldBeInverted === null ? true : JSON.parse(shouldBeInverted);

    // for now, always start false
    localStorage.setItem('collectionVisible', false);
    let collectionVisible = localStorage.getItem('collectionVisible');
    collectionVisible = collectionVisible === null ? false : JSON.parse(collectionVisible);

    //localStorage.setItem('displayCV', false);
    let displayCV = localStorage.getItem('displayCV') === null ? false : JSON.parse(localStorage.getItem('displayCV'));
    displayCV = displayCV === null ? false : JSON.parse(displayCV);
    displayVisionToggle.checked = displayCV;

    //localStorage.setItem('devOptionsVisible', false);
    let devOptionsVisible = localStorage.getItem('devOptionsVisible');
    devOptionsVisible = devOptionsVisible === null ? false : JSON.parse(devOptionsVisible);
    devOptionsToggle.checked = devOptionsVisible;

    initializeCheckboxes();

    const devOptions = document.getElementById('devOptions');
    devOptions.style.display = devOptionsVisible === true ? 'block' : 'none';

    invertCameraToggle.checked = shouldBeInverted;
    let flashlightOn = false; // Initial state of the flashlight

    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        flashlightToggle.style.display = 'none'; // Hide flashlight control on iOS devices
    } else {
        flashlightToggle.style.display = 'none'; // inline
    }

    flashlightToggle.addEventListener('click', function() {
        const videoTrack = video.srcObject?.getVideoTracks()[0]; // Get the active video track
        if (videoTrack) {
            flashlightOn = !flashlightOn; // Toggle the flashlight state
            videoTrack.applyConstraints({
                advanced: [{ torch: flashlightOn }]
            })
            .catch(e => {
                console.error(e);
                alert('Unable to access the flashlight.');
            });
        }
    });

    // invertCameraToggle.addEventListener('change', function() {
    //     shouldBeInverted = this.checked;
    //     video.style.transform = shouldBeInverted ? 'scaleX(-1)' : 'scaleX(1)';
    //     localStorage.setItem('cameraInverted', shouldBeInverted);
    // });

    const navbarToggle = document.querySelector('.navbar-toggler');
    const navbarContent = document.querySelector('#navbarToggleExternalContent');

    let currentDeviceId = localStorage.getItem('deviceId');
    let displayedComics = new Set();

    function getCameras() {
        return navigator.mediaDevices.enumerateDevices()
            .then(devices => devices.filter(device => device.kind === 'videoinput').slice(0, 2).reverse());
    }

    function startCamera(deviceId) {
        const constraints = {
            video: { deviceId: deviceId ? { exact: deviceId } : undefined }
        };
    
        navigator.mediaDevices.getUserMedia(constraints)
            .then(function(stream) {
                const videoTrack = stream.getVideoTracks()[0];
                const settings = videoTrack.getSettings();
    
                video.srcObject = stream;
                video.play();
    
                // Check if the front camera is being used and apply a mirror effect
                if (settings.facingMode === 'user') {
                    video.style.transform = 'scaleX(-1)';
                } else {
                    video.style.transform = 'scaleX(1)';
                }
                // video.style.transform = shouldBeInverted ? 'scaleX(-1)' : 'scaleX(1)';
            })
            .catch(function(error) {
                console.error("Error accessing the webcam", error);
            });
    }

    function onVideoClick(event) {
        const video = document.getElementById('webcam');
        const rect = video.getBoundingClientRect();
        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;
        const x = (event.clientX - rect.left) * scaleX;
    
        // Adjust y by subtracting the navbar's height to align with the actual video feed
        const y = (event.clientY - rect.top - document.querySelector('.navbar').offsetHeight) * scaleY;
    
        const contours = detectLargestContourInRegion(0, 0, video.videoWidth, video.videoHeight);
        const clickedContour = contours.find(c => c && x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height);
    
        if (clickedContour) {
            processSelectedArea(clickedContour.x, clickedContour.y, clickedContour.width, clickedContour.height);
        }
    }
    

    function startRealTimeDetection() {
        const video = document.getElementById('webcam');
        const overlayCanvas = document.getElementById('overlayCanvas');
        const overlayContext = overlayCanvas.getContext('2d');
        adjustCanvas(); // Ensure the canvas is correctly sized and positioned

        function processFrame() {
            if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
                if (video.videoWidth === 0 || video.videoHeight === 0) {
                    requestAnimationFrame(processFrame);
                    return;
                }

                overlayCanvas.width = video.videoWidth;
                overlayCanvas.height = video.videoHeight;

                overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                initializeCanvasContextForDrawing(overlayContext); // Set drawing styles

                const contours = detectLargestContourInRegion(0, 0, video.videoWidth, video.videoHeight);
                if (contours){//} && contours.length > 0) {
                    const rect = contours; // Assuming this is the largest contour
                    if (rect) {
                        overlayContext.strokeRect(rect.x, rect.y, rect.width, rect.height);
                    }
                }

                if (displayCV) {
                    requestAnimationFrame(processFrame);
                }
            } else {
                requestAnimationFrame(processFrame);
            }
        }

        if (displayCV) {
            requestAnimationFrame(processFrame);
        }
    }

    
    

    // overlayCanvas.addEventListener('click', onVideoClick);

    captureButton.addEventListener('click', function() {
        const contourResult = detectLargestContourInRegion(0, 0, video.videoWidth, video.videoHeight);
        if (contourResult) {
            const rect = contourResult;
            const maxWidth = 300;
            const maxHeight = 600;
            let scale = Math.min(maxWidth / rect.width, maxHeight / rect.height, 1);  // Ensure scale is not more than 1

            const croppedCanvas = document.createElement('canvas');
            const croppedWidth = rect.width * scale;
            const croppedHeight = rect.height * scale;
            croppedCanvas.width = croppedWidth;
            croppedCanvas.height = croppedHeight;
            const croppedCtx = croppedCanvas.getContext('2d');
            croppedCtx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, croppedWidth, croppedHeight);

            const imageDataUrl = croppedCanvas.toDataURL('image/jpeg', 0.7);
            sendImageToBackend(imageDataUrl);
            
            const overlayCanvas = document.getElementById('overlayCanvas');
            overlayCanvas.width = video.videoWidth;
            overlayCanvas.height = video.videoHeight;

            initializeCanvasContextForDrawing(overlayContext);
            overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            overlayContext.strokeRect(rect.x, rect.y, rect.width, rect.height);

            setTimeout(() => {
                overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            }, overlayDecay);
        } else {
            console.log('No suitable contour found');
            const maxWidth = 600;
            const maxHeight = 400;
            const fullImageCanvas = document.createElement('canvas');
            const fullImageCtx = fullImageCanvas.getContext('2d');
            let scale = Math.min(maxWidth / video.videoWidth, maxHeight / video.videoHeight, 1);
            const croppedWidth = video.videoWidth * scale;
            const croppedHeight = video.videoHeight * scale;
            fullImageCanvas.width = croppedWidth;
            fullImageCanvas.height = croppedHeight;
            fullImageCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, croppedWidth, croppedHeight);

            const imageDataUrl = fullImageCanvas.toDataURL('image/jpeg', 0.3);
            sendImageToBackend(imageDataUrl);
        }
    });      

    async function testMatchingAndMeasureResponseTime(imagePaths) {
        let responseTimes = [];
        let successfulMatches = 0;
    
        for (let imagePath of imagePaths) {
            const imageData = imagePath//await fetchImageAsBase64(imagePath);
            const startTime = performance.now();
    
            try {
                const response = await fetch(`${serverUrl}/capture`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: imageData })
                });
    
                const endTime = performance.now();
                const duration = endTime - startTime;
                responseTimes.push(duration);
    
                if (response.ok) {
                    const data = await response.json();
                    console.log(`Response for ${imagePath}:`, data);
                    const imagePathParts = imagePath.split('/');
                    const imageNameWithExtension = imagePathParts[imagePathParts.length - 1];
                    if (data.top_matches.hasOwnProperty(imageNameWithExtension)) {
                        successfulMatches++;
                    }
                } else {
                    console.error(`Request failed for ${imagePath}`);
                }
            } catch (error) {
                console.error(`Error during request for ${imagePath}:`, error);
            }
        }
    
        const averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        console.log(`Average response time: ${averageResponseTime}ms`);
        console.log(`Successful matches: ${successfulMatches} out of ${imagePaths.length}`);
    }    

    async function fetchImageFilenames() {
        const response = await fetch(`${serverUrl}/list-images`);
        if (response.ok) {
            const imageFilenames = await response.json();
            console.log('Image filenames:', imageFilenames);
            return imageFilenames;
        } else {
            console.error('Failed to fetch image filenames');
            return [];
        }
    }

    testButton.addEventListener('click', function() {
        const selectedImage = imageSelector.value;
        if (selectedImage === 'ALL'){
            // fetchImageFilenames().then(imageFilenames => {
            //     // Use the image filenames as needed
            //     testMatchingAndMeasureResponseTime(imageFilenames);
            // });
        } else {
            sendImageToBackend(selectedImage);
        }
        // console.log(`Testing with image: ${selectedImage}`);
        // testMatchingAndMeasureResponseTime(['/path/to/image1.jpg', '/path/to/image2.jpg']);
        
    });

    getCameras().then(cameras => {
        if (cameras.length <= 1) {
            switchCameraButton.style.display = 'none';
        } else {
            switchCameraButton.style.display = 'inline'; // Show the button if more than one camera
        }
    });

    switchCameraButton.addEventListener('click', () => {
        getCameras().then(cameras => {
            if (cameras.length > 1) {
                const currentCameraIndex = cameras.findIndex(camera => camera.deviceId === currentDeviceId);
                const nextCameraIndex = (currentCameraIndex + 1) % cameras.length;
                const nextCamera = cameras[nextCameraIndex];
                currentDeviceId = nextCamera.deviceId;
                localStorage.setItem('deviceId', currentDeviceId); // Store the current device ID
                startCamera(currentDeviceId);
            }
        });
    });

    navbarToggle.addEventListener('click', () => {
        // Toggle the visibility of the collapsible content
        const isExpanded = navbarToggle.getAttribute('aria-expanded') === 'true';
        if (isExpanded) {
            navbarContent.classList.remove('show');
            navbarToggle.setAttribute('aria-expanded', 'false');
        } else {
            navbarContent.classList.add('show');
            navbarToggle.setAttribute('aria-expanded', 'true');
        }
    });

    function initMessageBox(messageBox) {
        // let messageBox = collectionToggle.querySelector('.badge');
        if (!messageBox) {
            messageBox = document.createElement('span');
            messageBox.className = 'messageBox';
            // messageBox.style.position = 'absolute';
            // messageBox.style.top = '-10px';
            // messageBox.style.right = '-10px';
            messageBox.style.display = 'none';
            messageBox.style['white-space'] = 'nowrap';
            messageBox.style['background-color'] = 'rgba(0, 0, 0, 0.6)'; 
            messageBox.style['font-size'] = 'medium';
            messageBox.style.color = 'white'; 
            messageBox.style.padding = '10px'; 
            messageBox.style['border-radius'] = '8px'; 
            messageBox.style['z-index'] = 30;
            captureButton.appendChild(messageBox);
            messageBox.addEventListener('click', function(event) {
                event.stopPropagation();
                messageBox.style.display = 'none';
            });
        }
        return messageBox;
    }

    function sendImageToBackend(imageData) {
        let messageBox = captureButton.querySelector('.messageBox');
        messageBox = initMessageBox(messageBox);
        messageBox.style.display = 'none';

        const startTime = performance.now(); // Start timing

        return fetch(`${serverUrl}/capture`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image: imageData })
        })
        .then(response => {
            const endTime = performance.now(); // End timing
            const requestDuration = endTime - startTime; // Calculate the duration
            responseTimes.push(requestDuration); // Store the time

            const averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    
            const requestTimeDisplay = document.getElementById('requestTimeDisplay');
            if (requestTimeDisplay) {
                requestTimeDisplay.innerHTML = `Last request: ${requestDuration.toFixed(0)} ms<br> Average: ${averageResponseTime.toFixed(0)} ms`;
            }

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            // console.log('Success:', data);
            if (data.message) {
                messageBox.textContent = data.message;
                messageBox.style.display = 'block';
                updateCarousel(data.top_matches);
                setTimeout(() => {
                    messageBox.style.display = 'none';
                }, overlayTextDecay);
            }
        })
        .catch((error) => {
            console.error('Error:', error);
            messageBox.textContent = 'Error processing the image.';
            messageBox.style.display = 'block';
        });
    }

    function adjustEyeButtonPosition() {
        updateResultsIcon()

        const icon = resultsToggle.querySelector('i');
        const isShelfVisible = resultsShelf.style.display !== 'none';
    
        icon.className = isShelfVisible ? 'fas fa-angle-double-up' : 'fas fa-angle-double-down';

        resultsToggle.style.display = 'block';
        collectionToggle.style.display = 'block';

        requestAnimationFrame(() => {
            const navbarHeight = document.querySelector('.navbar').offsetHeight;
            const resultsShelfHeight = resultsShelf.offsetHeight;
            const resultsToggleWidth = resultsToggle.offsetWidth;
            const resultsToggleLeft = resultsToggle.offsetLeft;
    
            const topPosition = navbarHeight + resultsShelfHeight + 10; // Plus 10 for a little extra space
            resultsToggle.style.top = `${topPosition}px`;
            
            // Calculate left position for collectionToggle based on the position and width of resultsToggle
            const leftPositionForCollectionToggle = resultsToggleLeft + resultsToggleWidth + 10; // 10px space between buttons
            collectionToggle.style.top = `${topPosition}px`;
            collectionToggle.style.left = `${leftPositionForCollectionToggle}px`;
        });
    }

    function updateResultsIcon() {
        const resultCount = resultsCarousel.querySelectorAll('.result').length;

        const inCollectionCount = Array.from(document.querySelectorAll('.result .issue-status'))
        .filter(status => status.textContent === "In Collection")
        .length;

        let badge = collectionToggle.querySelector('.badge');
        if (badge) {
            badge.textContent = resultCount;
        } else {
            badge = document.createElement('span');
            badge.className = 'badge badge-danger';
            badge.style.position = 'absolute';
            badge.style.top = '-10px';
            badge.style.right = '-10px';
            badge.textContent = resultCount;
            collectionToggle.appendChild(badge);
        }
        badge.textContent = inCollectionCount;
        if (collectionVisible || inCollectionCount === 0) {
            badge.style.display = 'none';
        } else {
            badge.style.display = 'block';
        }
    }
    resultsShelf.style.display = 'block'; // or 'none' if you want it hidden initially
    adjustEyeButtonPosition();

    function getAverageColor(img) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        let r = 0, g = 0, b = 0;
    
        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
        }
    
        r = Math.floor(r / (data.length / 4));
        g = Math.floor(g / (data.length / 4));
        b = Math.floor(b / (data.length / 4));
    
        return { r, g, b };
    }
    
    // Find most-contrasting color against a given background color
    function contrastColor(rgb) {
        const brightness = Math.round(((parseInt(rgb.r) * 299) +
                                       (parseInt(rgb.g) * 587) +
                                       (parseInt(rgb.b) * 114)) / 1000);
        return (brightness > 125) ? 'black' : 'white';
    }

    function selectMatchModal(topMatches, resultDiv) {
        if (document.querySelector('.select-match-modal')) {
            return; // Do nothing if a modal is already open
        }
    
        const modal = document.createElement('div');
        modal.className = 'select-match-modal';
        modal.style.position = 'fixed';
        modal.style.left = '50%';
        modal.style.top = '50%';
        modal.style.transform = 'translate(-50%, -50%)';
        modal.style.backgroundColor = '#fff';
        modal.style.padding = '20px';
        modal.style.zIndex = '100';
        modal.style.borderRadius = '8px';
        modal.style.overflowY = 'auto';
        modal.style.maxHeight = '80vh';
    
        const title = document.createElement('h4');
        title.textContent = 'Select the Correct Match';
        modal.appendChild(title);
    
        Object.entries(topMatches).forEach(([fileName, metadata], index) => {
            const matchDiv = document.createElement('div');
            matchDiv.className = 'match-option';
            matchDiv.style.display = 'flex';
            matchDiv.style.marginBottom = '10px';
            matchDiv.style.cursor = 'pointer';
            matchDiv.dataset.fileName = fileName;
    
            const image = document.createElement('img');
            image.src = metadata.cover_url;
            image.alt = metadata.title;
            image.style.width = '100px';
            image.style.height = '150px';
            image.style.objectFit = 'cover';
            image.style.marginRight = '10px';
    
            const infoDiv = document.createElement('div');
            const seriesName = document.createElement('p');
            seriesName.textContent = metadata.series;
            const issueNumber = document.createElement('p');
            issueNumber.textContent = `Issue: ${metadata.issue_number}`;
    
            infoDiv.appendChild(seriesName);
            infoDiv.appendChild(issueNumber);
            matchDiv.appendChild(image);
            matchDiv.appendChild(infoDiv);
    
            matchDiv.addEventListener('click', () => {
                document.body.removeChild(modal);
                updateCarousel({ [fileName]: metadata });
            });
    
            modal.appendChild(matchDiv);
        });
    
        const closeButton = document.createElement('button');
        closeButton.textContent = 'Delete and Cancel';
        closeButton.addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        modal.appendChild(closeButton);
    
        document.body.appendChild(modal);
    }
    
    function updateCarousel(topMatches) {
        if (Object.entries(topMatches).length === 0){
            return;
        }
        const carousel = document.getElementById('resultsCarousel');

        let [fileName, metadata] = Object.entries(topMatches)[0];
        // Remove existing highlighted result if it exists
        const existingHighlighted = carousel.querySelector('.highlighted');
        if (existingHighlighted) {
            carousel.removeChild(existingHighlighted);
        }

        // Append only the first result as a representation
        const resultDiv = document.createElement('div');
        resultDiv.dataset.fileName = fileName;

        if (Object.keys(topMatches).length > 1) {
            fileName = `?${fileName}`;
            resultDiv.style.backgroundColor = 'lightcoral';
            resultDiv.className = 'result highlighted'; // Use highlighted class to indicate it's selectable
            resultDiv.addEventListener('click', () => {
                if (!document.querySelector('.select-match-modal')) {
                    selectMatchModal(topMatches, resultDiv); // Pass all topMatches for selection
                }
            });
        } else {
            if (displayedComics.has(fileName)) return;
            resultDiv.className = 'result';
        }

        adjustEyeButtonPosition();

        resultDiv.style.width = '100px';

        const image = document.createElement('img');
        image.src = metadata.cover_url;
        image.alt = metadata.title;
        image.style.width = '100%'; // Image fills the container
        image.style.display = 'block'; // Ensure there is no margin below the image
        
        image.onload = () => {
            // Calculate the actual bottom position for the issue number based on the image height

            const issueValueDiv = document.createElement('div');
            issueValueDiv.className = 'issue-value';
            if(metadata.value === "0.00"){
                issueValueDiv.textContent = `Value: Undefined`;
            } else {
                issueValueDiv.textContent = `Value: $${metadata.value}`;
            }

            const imageHeight = image.offsetHeight;
            issueValueDiv.style.bottom = `${imageHeight}px`;
            resultDiv.appendChild(issueValueDiv);
            requestAnimationFrame(() => {
                const imageHeight = image.offsetHeight;
                issueValueDiv.style.bottom = `${imageHeight}px`;
            });
            resultDiv.appendChild(issueValueDiv);
        };

        resultDiv.appendChild(image);

        const closeButton = document.createElement('button');
        closeButton.className = 'close-button';
        closeButton.innerHTML = '&times;';
        closeButton.onclick = function() {
            // Remove this result from the carousel
            carousel.removeChild(resultDiv);
            displayedComics.delete(fileName);
            adjustEyeButtonPosition();
        };
        resultDiv.appendChild(closeButton);

        const seriesNameWrapper = document.createElement('div');
        seriesNameWrapper.style.overflow = 'auto';
        seriesNameWrapper.style.whiteSpace = 'nowrap';
        seriesNameWrapper.style.maxWidth = '100px';  // Scrollable container

        const seriesName = document.createElement('p');
        seriesName.textContent = metadata.series;
        seriesName.className = 'series-title'
        seriesNameWrapper.appendChild(seriesName);

        resultDiv.appendChild(seriesNameWrapper);
            
        const issue = document.createElement('p');
        issue.className = 'issue-num'
        issue.textContent = `Issue: ${metadata.issue_number}`;
        resultDiv.appendChild(issue);

        const owned = document.createElement('p');
        owned.className = 'issue-status';
        owned.textContent = Object.keys(topMatches).length > 1 ? "Unknown" : `${metadata.collection_status}`;
        resultDiv.appendChild(owned);

        requestAnimationFrame(() => {
            if (metadata.collection_status === "In Collection" && Object.keys(topMatches).length === 1) {
                if(!collectionVisible){
                    resultDiv.style.display = 'none';
                } else {
                    resultDiv.style.display = 'inline-block';
                }
            }
            adjustEyeButtonPosition();
        });

        resultDiv.style.display = collectionVisible ? 'none' : 'inline-block';

        carousel.appendChild(resultDiv);
        displayedComics.add(fileName);
    }

    // Toggle function
    resultsToggle.addEventListener('click', function() {
        const isShelfVisible = resultsShelf.style.display !== 'none';
        resultsShelf.style.display = isShelfVisible ? 'none' : 'block';
    
        const icon = resultsToggle.querySelector('i');
        icon.className = isShelfVisible ? 'fas fa-angle-double-up' : 'fas fa-angle-double-down';
    
        adjustEyeButtonPosition();
    });

    collectionToggle.addEventListener('click', function() {
        const results = document.querySelectorAll('.result');

        results.forEach(result => {
            const issueValueDiv = result.querySelector('.issue-value');
            const status = result.querySelector('.issue-status').textContent;
            if (status === "In Collection") {
                result.style.display = collectionVisible ? 'none' : 'inline-block';
            }
            if (!collectionVisible && issueValueDiv) {
                // Ensure the image is loaded
                const img = result.querySelector('img');
                if (img.complete && img.naturalHeight !== 0) {
                    // Image is loaded, recalculate the position
                    issueValueDiv.style.bottom = `${img.offsetHeight}px`;
                } else {
                    // If the image is not yet loaded, add an onload handler
                    img.onload = () => {
                        issueValueDiv.style.bottom = `${img.offsetHeight}px`;
                    };
                }
            }
        });

        const icon = collectionToggle.querySelector('i');
        icon.className = collectionVisible ? 'fas fa-eye' : 'fas fa-eye-slash';
        collectionVisible = !collectionVisible;
        localStorage.setItem('collectionVisible', collectionVisible);

        adjustEyeButtonPosition();
    });

    document.addEventListener('click', function(event) {
        const navbarContent = document.getElementById('navbarToggleExternalContent');
        const navbarToggle = document.querySelector('.navbar-toggler');
        if (!navbarContent.contains(event.target) && !navbarToggle.contains(event.target)) {
            navbarContent.classList.remove('show');
            navbarToggle.classList.add('collapsed');
            navbarToggle.setAttribute('aria-expanded', 'false');
        }
    });

    const shareButton = document.getElementById('shareButton');
    shareButton.addEventListener('click', function() {
        // Find all result items that are not "In Collection"
        let itemsToShare = [];
        document.querySelectorAll('.result p').forEach(p => {
            if (p.textContent.includes('On Wish List')) {
                itemsToShare.push(p.parentNode.querySelector('.series-title').textContent);
                itemsToShare.push(p.parentNode.querySelector('.issue-num').textContent);
                itemsToShare.push('');
            }
        });
        // Copy items to clipboard
        if (navigator.clipboard) {
            navigator.clipboard.writeText(itemsToShare.join('\n')).then(() => {
            console.log('Names copied to clipboard');
            }).catch(err => {
            console.error('Could not copy text: ', err);
            });
        }
    });

    // invertCameraToggle.checked = shouldBeInverted;
    // invertCameraToggle.addEventListener('change', function() {
    //     shouldBeInverted = this.checked;
    //     video.style.transform = shouldBeInverted ? 'scaleX(-1)' : 'scaleX(1)';
    //     localStorage.setItem('cameraInverted', shouldBeInverted);
    // });

    // displayVisionToggle.addEventListener('change', function() {
    //     displayCV = this.checked;
    //     if(displayCV) {
    //         startRealTimeDetection();
    //         //overlayCanvas.style.display = 'block'; // Show the canvas when display is on
    //     } else {
    //         // requestAnimationFrame(function() {overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)});
    //         //overlayCanvas.style.display = 'none'; // Hide the canvas when display is off
    //     }
    // });

    // devOptionsToggle.addEventListener('change', function() {
    //     devOptionsVisible = this.checked;
    //     if(devOptionsVisible) {
    //         devOptions.style.display = 'block';
    //         //startRealTimeDetection();
    //         //overlayCanvas.style.display = 'block'; // Show the canvas when display is on
    //     } else {
    //         devOptions.style.display = 'none';
    //         // requestAnimationFrame(function() {overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)});
    //         //overlayCanvas.style.display = 'none'; // Hide the canvas when display is off
    //     }
    // });

    document.addEventListener('touchstart', function(event) {
        let lastTouchEnd = 0;
        document.addEventListener('touchend', function(e) {
            const now = (new Date()).getTime();
            if (now - lastTouchEnd <= 150) { // 300ms is typically used to detect double-tap
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, false);
    }, false);
};