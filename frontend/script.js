document.getElementById("uploadForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const fileInput = document.getElementById("file");
    const file = fileInput.files[0];

    if (!file) {
        alert("Please select a CSV file.");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);

    const statusDiv = document.getElementById("status");
    statusDiv.textContent = "Processing...";

    try {
        const response = await fetch("/upload", {
            method: "POST",
            body: formData,
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "barcodes.zip";
            document.body.appendChild(a);
            a.click();
            a.remove();
            statusDiv.textContent = "Barcodes generated successfully! File downloaded.";
        } else {
            statusDiv.textContent = "Failed to generate barcodes.";
        }
    } catch (err) {
        statusDiv.textContent = "An error occurred. Please try again.";
        console.error(err);
    }
});
