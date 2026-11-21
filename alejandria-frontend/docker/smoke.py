"""Smoke del proxy/UI compilada. Fixtures solo en un proyecto Compose aislado.

Ejecutar después de migrar explícitamente la base test_* del proyecto. No imprime
credenciales y nunca registra cuentas en el Compose operativo 'alejandria'.
"""
import argparse
import json
import os
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import uuid


def inspect(name):
    return json.loads(subprocess.check_output(["docker", "inspect", name]))[0]


def run(args):
    if not args.project.startswith("alejandria-orchestration-check"):
        raise SystemExit("Use an isolated alejandria-orchestration-check* project")
    frontend = inspect(args.project + "-frontend-1")
    backend = inspect(args.project + "-backend-1")
    postgres = inspect(args.project + "-postgres-1")
    environment = dict(value.split("=", 1) for value in backend["Config"]["Env"])
    if not environment["APP_DATABASE_NAME"].startswith("test_"):
        raise SystemExit("Refusing a non-test database")
    for container in (frontend, backend, postgres):
        assert container["Config"]["Labels"]["com.docker.compose.project"] == args.project
        assert set(container["NetworkSettings"]["Networks"]) == {args.project + "_default"}
    port = frontend["NetworkSettings"]["Ports"]["8080/tcp"][0]["HostPort"]
    base = f"http://127.0.0.1:{port}"
    checks = []

    def request(method, path, token=None, body=None, expected=200):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        try:
            response = urllib.request.urlopen(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            data = response.read()
            accepted = expected if isinstance(expected, tuple) else (expected,)
            assert response.code in accepted, (method, path, response.code, expected)
            checks.append({"method": method, "path": path, "status": response.code})
            return data, response.headers

    home, _ = request("GET", "/")
    assert b"<div id=\"root\">" in home
    for path in ("/login", "/catalog", "/books/123"):
        page, _ = request("GET", path)
        assert page == home, "SPA deep-link did not use index.html"
    assets = re.findall(rb'(?:src|href)="(/assets/[^\"]+)"', home)
    assert assets
    for asset in assets:
        content, headers = request("GET", asset.decode())
        assert content and "immutable" in headers.get("Cache-Control", "")
    request("GET", "/assets/missing.js", expected=404)
    data, headers = request("GET", "/api/v1/auth/me", expected=401)
    assert "application/json" in headers["Content-Type"] and json.loads(data)["status"] == 401
    data, _ = request("GET", "/api/v1/not-a-route", expected=404)
    assert b"<html" not in data.lower(), "API 404 was replaced by SPA HTML"

    password = secrets.token_urlsafe(24)
    email = f"reader-{uuid.uuid4()}@synthetic.invalid"
    data, _ = request("POST", "/api/v1/auth/register", body={"email": email, "display_name": "Proxy smoke", "password": password}, expected=201)
    assert json.loads(data)["roles"] == ["lector"]
    data, _ = request("POST", "/api/v1/auth/login", body={"email": email, "password": password})
    token = json.loads(data)["access_token"]
    data, _ = request("GET", "/api/v1/auth/me", token)
    assert json.loads(data)["email"] == email
    data, _ = request("GET", "/api/v1/books?limit=1&offset=0", token)
    assert json.loads(data)["pagination"] == {"limit": 1, "offset": 0}
    request("GET", "/api/v1/books?limit=0", token, expected=400)
    data, _ = request("GET", "/api/v1/users/me/recommendations", token)
    assert json.loads(data)["status"] == "preferences_required"

    # Fuerza una llamada de inferencia; este proyecto no arranca otro modelo V2.
    admin_email = f"admin-{uuid.uuid4()}@synthetic.invalid"
    subprocess.run(["docker", "exec", "-i", args.project + "-backend-1", "/app/admin"], input=json.dumps({"email": admin_email, "display_name": "Proxy admin", "password": password}).encode(), check=True, capture_output=True)
    data, _ = request("POST", "/api/v1/auth/login", body={"email": admin_email, "password": password})
    admin = json.loads(data)["access_token"]
    data, _ = request("POST", "/api/v1/genres", admin, {"name": "fantasy, paranormal"})
    genre = json.loads(data)["id"]
    request("PUT", "/api/v1/users/me/preferences/genres", token, {"genre_ids": [genre]})
    request("GET", "/api/v1/users/me/recommendations", token, expected=(503, 504))
    request("GET", "/api/v1/auth/me", token)

    if args.recreate_backend:
        run_environment = os.environ.copy()
        run_environment.update(POSTGRES_DB=environment["APP_DATABASE_NAME"], POSTGRES_USER=environment["APP_DATABASE_USER"], POSTGRES_PASSWORD=environment["APP_DATABASE_PASSWORD"], APP_AUTH_SECRET=environment["APP_AUTH_SECRET"], APP_RECOMMENDATION_URL=environment["APP_RECOMMENDATION_URL"], FRONTEND_PORT=port, BACKEND_PORT=backend["NetworkSettings"]["Ports"]["8080/tcp"][0]["HostPort"], POSTGRES_PORT=postgres["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"])
        subprocess.run(["docker", "compose", "--env-file", args.env_file, "-p", args.project, "up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "60", "backend"], env=run_environment, check=True)
        for _ in range(30):
            try:
                request("GET", "/api/v1/auth/me", token)
                break
            except (AssertionError, OSError):
                time.sleep(0.5)
        else:
            raise AssertionError("proxy did not recover after backend recreation")
        assert inspect(args.project + "-frontend-1")["Id"] == frontend["Id"]
    print(json.dumps({"status": "passed", "project": args.project, "checks": checks, "backend_recreated": args.recreate_backend}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--recreate-backend", action="store_true")
    run(parser.parse_args())
