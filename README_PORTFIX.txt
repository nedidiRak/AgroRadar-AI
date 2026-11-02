AgroRadar AI - Windows port fix v2.1.3

1. Save a backup/commit of working project.
2. Stop old backend/frontend terminals (Ctrl+C), including old START_AGRORADAR.bat windows.
3. Copy START_AGRORADAR.bat to project root and backend/select_port.py,
   frontend/vite.config.ts to their respective folders, replacing old files.
4. Launch START_AGRORADAR.bat with a double click.
5. Check new backend window shows 'Uvicorn running on http://127.0.0.1:PORT'.
6. Open http://localhost:5173/ ; call http://127.0.0.1:PORT/api/health
   with the PORT displayed in the new backend window.

The launcher picks a free local port and writes it to frontend/.agroradar-api-port.
Vite reads that file when it starts and automatically proxies /api to the new port.
Never run the old backend command (without --port) alongside the launcher.

If GitHub Desktop shows frontend/.agroradar-api-port as a new file, add this line
in the project's root .gitignore:
frontend/.agroradar-api-port
This is a local configuration file, not a secret.

Windows diagnostics (PowerShell):
netsh interface ipv4 show excludedportrange protocol=tcp
netsh interface ipv6 show excludedportrange protocol=tcp

If the new backend still shows WinError 10013, copy the full log. This may be a
system/security policy blocking local sockets, not a specific port reservation.
