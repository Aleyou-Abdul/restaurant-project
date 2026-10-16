# Silent POS Receipt Printing

Use this only on a dedicated restaurant computer connected to the Xprinter. It sends printing directly to the Windows default printer without showing Chrome's print preview.

## One-time printer setup

1. Open **Windows Settings** and go to **Bluetooth & devices > Printers & scanners**.
2. Select the Xprinter, choose **Set as default**, and open **Printing preferences**.
3. Select the printer's **80mm receipt roll** paper size. The Xprinter XP-80 in the test photo uses 80mm paper.
4. In PlateRoute Admin, make sure **Receipt Paper Width** is also set to **80mm POS paper**.

## Create the POS shortcut

1. Copy the exact Admin or Staff login link from the browser address bar. It should include the restaurant ID.
2. Open PowerShell in the project folder.
3. Run this command, replacing the example link with the copied link:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-pos-printing-shortcut.ps1 -DashboardUrl "https://YOUR-RAILWAY-DOMAIN.up.railway.app/admin-login.html?restaurantId=YOUR_RESTAURANT_ID"
```

4. Close all normal Chrome windows once.
5. Open the new **PlateRoute POS - Silent Printing** shortcut on the desktop and sign in.

From that dedicated POS window, **Print Receipt** sends the receipt straight to the default Xprinter. The dashboard remains visible and no print preview appears.

## Safety

The shortcut uses Chrome's kiosk-printing mode. Any print action from that separate POS window goes to the default printer without confirmation. Use it only for the trusted PlateRoute POS computer; use normal Chrome for browsing and reports that you want to preview first.
