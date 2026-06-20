(function () {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key");
    const returnUrl = params.get("return") || "";
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

    const isReceipt = Boolean(parsedDocument.querySelector(".print-shell"));
    const pageStyle = document.createElement("style");
    pageStyle.textContent = isReceipt
        ? `
            @page { size: 80mm 297mm; margin: 1mm; }
            html, body { width: 80mm; min-width: 80mm; max-width: 80mm; margin: 0 auto; background: #fff; }
            #print-root { width: 72mm; margin: 0 auto; padding: 0; }
            #print-root .print-shell { width: 72mm !important; max-width: 72mm !important; margin: 0 auto !important; }
            @media print {
                html, body { width: 80mm !important; min-width: 80mm !important; max-width: 80mm !important; }
                #print-root { width: 72mm !important; max-width: 72mm !important; margin: 0 auto !important; padding: 0 !important; }
            }
        `
        : `
            @page { size: A4; margin: 14mm; }
            html, body { margin: 0; background: #fff; }
            #print-root { width: 100%; }
        `;
    document.head.appendChild(pageStyle);
    document.body.className = isReceipt ? "receipt-print-body" : "report-print-body";
    root.className = "";
    root.innerHTML = parsedDocument.body.innerHTML;

    function waitForImages() {
        const images = [...document.images];

        if (!images.length) {
            return Promise.resolve();
        }

        return Promise.allSettled(images.map((image) => {
            if (image.complete) {
                return Promise.resolve();
            }

            return new Promise((resolve) => {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", resolve, { once: true });
            });
        }));
    }

    function printSoon() {
        window.print();
        window.setTimeout(() => {
            localStorage.removeItem(storageKey);
        }, 1000);
    }

    window.addEventListener("afterprint", () => {
        localStorage.removeItem(storageKey);

        if (returnUrl) {
            window.setTimeout(() => {
                window.location.href = returnUrl;
            }, 250);
        }
    });

    Promise.race([
        waitForImages(),
        new Promise((resolve) => window.setTimeout(resolve, 350))
    ]).then(() => {
        window.requestAnimationFrame(() => window.setTimeout(printSoon, 50));
    });
})();
