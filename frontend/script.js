const scanButton = document.getElementById("scanButton");
const websiteUrl = document.getElementById("websiteUrl");
const resultMessage = document.getElementById("resultMessage");

scanButton.addEventListener("click", async function () {

    const url = websiteUrl.value.trim();

    // Check empty input
    if (url === "") {
        resultMessage.textContent = "Please enter a website URL.";
        return;
    }

    // Validate URL
    let validUrl;

    try {
        validUrl = new URL(url);

        if (
            validUrl.protocol !== "http:" &&
            validUrl.protocol !== "https:"
        ) {
            throw new Error("Invalid protocol");
        }

    } catch (error) {
        resultMessage.textContent =
            "Please enter a valid website URL (https://example.com).";
        return;
    }

    // Show scanning message
    scanButton.disabled = true;
    scanButton.textContent = "Scanning...";
    resultMessage.textContent = "Connecting to backend and scanning website...";

    try {

        // Send URL to Flask backend
        const response = await fetch("http://127.0.0.1:5000/api/scan", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                url: validUrl.href
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Unable to scan website.");
        }

        // Display scan results
        let output = data.message;

        output += "\n\nWebsite: " + data.url;

        output += "\n\nTotal possible patterns detected: "
            + data.total_detected;

        if (data.results.length > 0) {

            data.results.forEach(function (item, index) {

                output += "\n\n" + (index + 1) + ". " + item.pattern;

                output += "\nEvidence: "
                    + item.evidence.join(", ");

            });

        } else {

            output += "\n\nNo matching indicators were found.";

        }

        output += "\n\nNote: " + data.note;

        resultMessage.textContent = output;

    } catch (error) {

        resultMessage.textContent =
            "Error: " + error.message
            + "\n\nPlease make sure the Flask backend is running.";

    } finally {

        scanButton.disabled = false;
        scanButton.textContent = "Scan Website";

    }

});