@echo off
REM 梓安互联桥 · 防火墙规则（需要以管理员身份运行本批处理）
echo 正在为梓安互联桥添加防火墙规则...

netsh advfirewall firewall add rule name="梓安互联桥-UDP-35791" dir=in action=allow protocol=UDP localport=35791 profile=any
netsh advfirewall firewall add rule name="梓安互联桥-TCP-35791" dir=in action=allow protocol=TCP localport=35791 profile=any
netsh advfirewall firewall add rule name="梓安互联桥-TCP-35792" dir=in action=allow protocol=TCP localport=35792 profile=any

echo.
echo 完成！请按任意键退出
pause >nul
