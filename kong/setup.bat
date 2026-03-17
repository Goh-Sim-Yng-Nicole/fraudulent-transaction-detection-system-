@echo off
setlocal

set KONG=http://localhost:8001
set NGINX=http://host.docker.internal:80
set JWT_KEY=ftds-customer-service
set JWT_SECRET=ftds-dev-secret-change-in-production-32chars

echo.
echo =============================================
echo   Configuring Kong for FTDS
echo   Kong Admin : %KONG%
echo   Upstream   : %NGINX%
echo =============================================
echo.

echo [1/7] Creating FTDS service (Kong -> Nginx)...
curl -s -o NUL -w "  HTTP %%{http_code}" -X POST %KONG%/services ^
  --data "name=ftds" ^
  --data "url=%NGINX%"
echo.

echo [2/7] Public route for auth (no JWT required)...
curl -s -o NUL -w "  HTTP %%{http_code}" -X POST %KONG%/services/ftds/routes ^
  --data "name=ftds-auth" ^
  --data "paths[]=/api/auth" ^
  --data "strip_path=false"
echo.

echo [3/7] Public route for UI static files...
curl -s -o NUL -w "  HTTP %%{http_code}" -X POST %KONG%/services/ftds/routes ^
  --data "name=ftds-ui" ^
  --data "paths[]=/" ^
  --data "strip_path=false"
echo.

echo [4/7] Protected routes (JWT required)...
curl -s -o NUL -w "  HTTP %%{http_code}" -X POST %KONG%/services/ftds/routes ^
  --data "name=ftds-protected" ^
  --data "paths[]=/api/customers" ^
  --data "paths[]=/api/customer" ^
  --data "paths[]=/api/fraud" ^
  --data "strip_path=false"
echo.

echo [5/7] Creating Kong consumer + JWT credential...
curl -s -o NUL -w "  HTTP %%{http_code}" -X POST %KONG%/consumers ^
  --data "username=ftds-customers"
echo.
curl -s -o NUL -w "  HTTP %%{http_code}" -X POST %KONG%/consumers/ftds-customers/jwt ^
  --data "algorithm=HS256" ^
  --data "key=%JWT_KEY%" ^
  --data "secret=%JWT_SECRET%"
echo.

echo [6/7] Enabling JWT plugin on protected routes...
curl -s -o NUL -w "  HTTP %%{http_code}" -X POST %KONG%/routes/ftds-protected/plugins ^
  --data "name=jwt"
echo.

echo [7/7] Enabling rate limiting (60 req/min per IP)...
curl -s -o NUL -w "  HTTP %%{http_code}" -X POST %KONG%/routes/ftds-protected/plugins ^
  --data "name=rate-limiting" ^
  --data "config.minute=60" ^
  --data "config.policy=local"
echo.

echo.
echo =============================================
echo   Done!
echo   Customer Banking UI : http://localhost:8000
echo   API (via Kong)      : http://localhost:8000/api/...
echo   Kong Admin API      : http://localhost:8001
echo =============================================
echo.

endlocal
