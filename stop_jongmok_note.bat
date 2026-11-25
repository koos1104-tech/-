@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 exit /b 0
node -e "const h=require('http');const body=JSON.stringify({confirm:'shutdown'});const req=h.request('http://127.0.0.1:3000/api/local-shutdown',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},r=>{r.resume();process.exit(0);});req.on('error',()=>process.exit(0));req.write(body);req.end();"
exit /b 0
