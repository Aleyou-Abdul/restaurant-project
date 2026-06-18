(function () {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key");
    const storageKey = key ? `printDocument:${key}` : "";
    const root = document.getElementById("print-root");

    function showError(message) {
        root.className = "print-error";
        root.innerHTML = `<h1>Print document unavailable</h1><p>${message}</p>`;
    }

    if (!storageKey) {
        showError("No print document key was provided.");
        return;
    }

    const documentMarkup = localStorage.getItem(storageKey);

    if (!documentMarkup) {
        showError("The print document was not found. Please go back and click Print again.");
        return;
    }

    const parsedDocument = new DOMParser().parseFromString(documentMarkup, "text/html");
    const title = parsedDocument.querySelector("title");

    if (title && title.textContent) {
        document.title = title.textContent;
    }

    parsedDocument.querySelectorAll("link[rel='stylesheet']").forEach((link) => {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = link.getAttribute("href");
        document.head.appendChild(stylesheet);
    });

    parsedDocument.querySelectorAll("style").forEach((style) => {
        const printStyle = document.createElement("style");
        printStyle.textContent = style.textContent;
        document.head.appendChild(printStyle);
    });

    root.className = "";
    root.innerHTML = parsedDocument.body.innerHTML;

    window.setTimeout(() => {
        window.print();
        window.setTimeout(() => {
            localStorage.removeItem(storageKey);
        }, 1000);
    }, 500);
})();
