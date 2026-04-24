document.addEventListener("DOMContentLoaded", () => {
    const ownerReportStatusEl = document.getElementById("owner-report-status");
    const ownerRangeFilterEl = document.getElementById("owner-range-filter");
    const ownerRefreshBtn = document.getElementById("owner-refresh-btn");
    const ownerDownloadBtn = document.getElementById("owner-download-btn");
    const ownerPrintBtn = document.getElementById("owner-print-btn");
    const ownerLogoutBtn = document.getElementById("owner-logout-btn");
    const ownerTotalOrdersEl = document.getElementById("owner-total-orders");
    const ownerTotalQuantityEl = document.getElementById("owner-total-quantity");
    const ownerTotalSalesEl = document.getElementById("owner-total-sales");
    const ownerReportBodyEl = document.getElementById("owner-report-body");
    const ownerReportTotalValueEl = document.getElementById("owner-report-total-value");

    let reportCache = {
        items: [],
        totalItemSales: 0,
        totalOrders: 0
    };

    function formatPrice(amount) {
        return `\u20A6${Number(amount || 0)}`;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    async function fetchJson(url, options) {
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Request failed.");
        }

        return data;
    }

    function setReportStatus(message, type) {
        ownerReportStatusEl.textContent = message;
        ownerReportStatusEl.className = `payment-status ${type}`;
    }

    function renderReport(report) {
        reportCache = report;
        ownerReportBodyEl.innerHTML = "";

        if (!report.items.length) {
            ownerReportBodyEl.innerHTML = '<tr><td colspan="3">No item sales in this range.</td></tr>';
        } else {
            report.items.forEach((item) => {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${escapeHtml(item.name)}</td>
                    <td>${escapeHtml(item.quantity)}</td>
                    <td>${formatPrice(item.total)}</td>
                `;
                ownerReportBodyEl.appendChild(row);
            });
        }

        ownerTotalOrdersEl.textContent = String(report.totalOrders || 0);
        ownerTotalQuantityEl.textContent = String(
            (report.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)
        );
        ownerTotalSalesEl.textContent = formatPrice(report.totalItemSales || 0);
        ownerReportTotalValueEl.textContent = formatPrice(report.totalItemSales || 0);
    }

    function getRangeLabel() {
        const labels = {
            today: "Today",
            week: "This Week",
            month: "This Month",
            all: "All Time"
        };

        return labels[ownerRangeFilterEl.value] || "All Time";
    }

    function getPrintDocument(report) {
        const rows = (report.items || [])
            .map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.quantity)}</td><td>${formatPrice(item.total)}</td></tr>`)
            .join("");

        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Owner Sales Report</title><style>body{font-family:Poppins,Arial,sans-serif;margin:0;padding:32px;color:#111;background:#fff}.sheet{max-width:820px;margin:0 auto;border:1px solid #ddd;border-radius:16px;padding:28px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #e5e7eb}h1,p{margin-top:0}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:20px 0}.summary-card{padding:14px;border:1px solid #ddd;border-radius:14px}.owner-total{display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding-top:16px;border-top:2px solid #111;font-size:20px;font-weight:700}@media print{body{padding:0}.sheet{border:none;border-radius:0;padding:0}}</style></head><body><div class="sheet"><h1>Owner Sales Report</h1><p>Range: ${getRangeLabel()}</p><div class="summary"><div class="summary-card"><strong>Total Orders</strong><p>${report.totalOrders || 0}</p></div><div class="summary-card"><strong>Total Items</strong><p>${(report.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</p></div><div class="summary-card"><strong>Total Item Sales</strong><p>${formatPrice(report.totalItemSales || 0)}</p></div></div><table><thead><tr><th>Item</th><th>Quantity</th><th>Total</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No item sales in this range.</td></tr>'}</tbody></table><div class="owner-total"><span>Total of all item sales</span><span>${formatPrice(report.totalItemSales || 0)}</span></div></div></body></html>`;
    }

    function openPrintView(report) {
        const printWindow = window.open("", "_blank", "width=1000,height=760");

        if (!printWindow) {
            setReportStatus("Please allow popups to print or download the report.", "error");
            return null;
        }

        printWindow.document.open();
        printWindow.document.write(getPrintDocument(report));
        printWindow.document.close();
        return printWindow;
    }

    async function loadReport() {
        const range = ownerRangeFilterEl.value || "all";
        const data = await fetchJson(`/api/owner/report?range=${encodeURIComponent(range)}`);
        renderReport(data.report || reportCache);
        return data.report;
    }

    async function refreshReport() {
        try {
            setReportStatus("Loading owner report...", "info");
            await loadReport();
            setReportStatus("Owner report is up to date.", "success");
        } catch (error) {
            setReportStatus(error.message, "error");
        }
    }

    async function checkSession() {
        try {
            const data = await fetchJson("/api/owner/session");

            if (!data.hasOwnerPassword || !data.isAuthenticated) {
                window.location.href = "owner-login.html";
                return;
            }

            refreshReport();
        } catch (error) {
            setReportStatus(error.message, "error");
        }
    }

    ownerRangeFilterEl.addEventListener("change", refreshReport);
    ownerRefreshBtn.addEventListener("click", refreshReport);

    ownerPrintBtn.addEventListener("click", () => {
        const printWindow = openPrintView(reportCache);

        if (printWindow) {
            printWindow.focus();
            printWindow.print();
        }
    });

    ownerDownloadBtn.addEventListener("click", () => {
        const printWindow = openPrintView(reportCache);

        if (printWindow) {
            printWindow.focus();
            printWindow.print();
        }
    });

    ownerLogoutBtn.addEventListener("click", async () => {
        try {
            await fetchJson("/api/owner/logout", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                }
            });
        } catch (error) {
            // Ignore logout errors and redirect anyway.
        }

        window.location.href = "owner-login.html";
    });

    checkSession();
});
