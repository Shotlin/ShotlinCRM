# Connect the CRM to your Google Drive (about 15 minutes, free)

The CRM saves each invoice's PDF and Word file into your Drive quarter folders and keeps your master
workbook up to date. This is done by a small script that lives **in your own Google account**.
Your folder stays private (Restricted). Nothing is shared with anyone.

## Before you start

1. **Decide which workbook is the real master.** Your own audit says the master is not reconciled yet.
   Do not connect the CRM to a workbook you are unsure about.
2. **Make the master a Google Sheet.** Open the master file in Drive, then
   File, **Save as Google Sheets**. This makes a new Google Sheet next to the Excel file.
   The Excel original is left alone. (Some of its formulas only run live as a Google Sheet.)
3. Open the new Google Sheet and copy its ID from the address bar: it is the long text between
   `/spreadsheets/d/` and `/edit`.

## Set up the script

1. Go to **script.google.com**, press **New project**, and name it `Shotlin CRM Drive link`.
2. Delete the sample code and paste the whole of `Code.gs` (from this folder).
3. Click the gear (**Project Settings**), tick **Show "appsscript.json" manifest file in editor**.
   Go back to the editor, open `appsscript.json`, and replace its content with the file of the same
   name from this folder. (It sets the time zone to India and the web app options.)
4. In **Project Settings**, scroll to **Script Properties** and add two properties:
   - `SHEET_ID` = the Google Sheet ID you copied above.
   - `TOKEN` = a long secret password. The CRM generates this for you (see "Hand over to the CRM").
     Until then you can put any long random text here and replace it later.
5. Back in the editor, choose the function **testMySetup** in the top bar and press **Run**.
   Google asks you to approve access to Drive and Sheets. Approve it.
   Open **Execution log**. You should see your three tabs listed as `ok` and your two folders by name.
   If it says a column "should be ... but is ...", the workbook layout has changed. Nothing was written.
6. Press **Deploy**, then **New deployment**. Choose the type **Web app**.
   - **Execute as:** Me
   - **Who has access:** Anyone
   Press **Deploy** and copy the **Web app URL** (it ends in `/exec`).

"Anyone" only means the address does not need a Google login. Every request must carry the secret
`TOKEN`, so without it the script refuses and shows nothing.

## Hand over to the CRM

Send the **Web app URL** to Claude. The CRM server gets the URL and a freshly generated secret token.
To read the token once, on your Mac:

```bash
ssh root@200.234.44.216 "grep ^DRIVE_SCRIPT_TOKEN /opt/shotlin-crm/.env"
```

Paste that value into the `TOKEN` Script Property, then press **Deploy, Manage deployments, Edit,
New version, Deploy** so the script uses it. The token is never put in chat or in the code.

## What the CRM does after that

| When | Drive | Workbook |
|---|---|---|
| Draft created | PDF and Word in `00 - Pending GST Invoices` | Row in `GST_Pending` ("Reserved / Pending") |
| Issued (final / regular invoice) | Moved to the quarter folder, for example `Q3 (Oct-Dec 2026)` | Row in `GST_Series`; the Pending row becomes "Promoted / Paid" |
| Issued advance, not yet paid | Stays in Pending | Stays reserved in `GST_Pending` |
| Payment recorded | PDF replaced (shows the new status). An advance moves to its quarter once paid. | Received, Balance and Payment Status updated; a line added to `Pay_Ledger` |
| Cancelled | File renamed `CANCELLED_...` and kept | Row kept with the number, money set to zero, note added |

- Quarter folders are created automatically when a new quarter starts.
- `Qtr_Sum`, `Mth_Sales`, `Series_Ctrl` and `Seq_Check` are your own formulas. They update by themselves.
- Files are only ever moved to the **Trash** (kept 30 days), never permanently deleted.
- The script writes only the typed columns. `GST Total` and `Dup Flag` stay formulas. Filing status and
  Notes on an existing row are never overwritten, because you maintain those.
- The script adds one column, `CRM Payment ID`, at column N of `Pay_Ledger`, so a payment is written once.
- If Google is slow or down, the invoice is still saved in the CRM and the sync retries by itself.
  Each invoice shows its Drive status and a **Sync now** button.

## Good to know

- **Advance rule.** By default an unpaid advance waits in Pending until it is paid, as you do today.
  Ask your accountant whether an advance should count in GST from its date. To file advances as soon
  as they are issued instead, set `DRIVE_ADVANCE_RULE=on_issue` on the server.
- **New financial year.** The register formulas cover rows 7 to 506. In April, add the new year's rows
  to the `Qtr_Sum` tab. The CRM will refuse to number an invoice for a new year until you set its first
  number on purpose.
- **Limits.** Google allows a script about 6 minutes per call and a daily quota far above what a small
  team uses. If the quota is ever hit, the CRM retries later.
- **Rotating the secret.** Change `TOKEN` in Script Properties and `DRIVE_SCRIPT_TOKEN` on the server together.
