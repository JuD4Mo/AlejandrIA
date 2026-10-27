"""Smoke real Go → FastAPI V2 con fixtures exclusivamente en PostgreSQL test_*.

Requiere un contenedor Go desechable con puerto 18080 y FastAPI listo en Compose.
No imprime credenciales, tokens ni IDs de usuarios.
"""
import datetime
import http.client
import json
import os
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import uuid

container = os.environ.get("SMOKE_CONTAINER", "alejandria-recommendation-smoke")
base = os.environ.get("SMOKE_BASE_URL", "http://127.0.0.1:18080")
inference_container = os.environ.get("SMOKE_INFERENCE_CONTAINER", "alejandria-recommendations-1")
inspection = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
env = dict(value.split("=", 1) for value in inspection["Config"]["Env"])
if not env.get("APP_DATABASE_NAME", "").startswith("test_"):
    raise SystemExit("Use a test_* disposable database")

timings = []


def call(method, path, token=None, payload=None, expected=200, server=base):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(server + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers, method=method)
    start = time.perf_counter()
    try:
        response = urllib.request.urlopen(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        out = json.load(response)
        assert response.code == expected, (path, response.code, out)
    elapsed = time.perf_counter() - start
    timings.append({"operation": method + " " + path, "status": expected, "seconds": round(elapsed, 4)})
    return out


password = secrets.token_urlsafe(24)
email = f"admin-{uuid.uuid4()}@synthetic.invalid"
subprocess.run(["docker", "exec", "-i", container, "/app/admin"], input=json.dumps({"email": email, "display_name": "Recommendation smoke", "password": password}).encode(), check=True)
staff = call("POST", "/api/v1/auth/login", payload={"email": email, "password": password})["access_token"]
tokens = []
for _ in range(2):
    reader_email = f"reader-{uuid.uuid4()}@synthetic.invalid"
    call("POST", "/api/v1/auth/register", payload={"email": reader_email, "display_name": "Recommendation reader", "password": password}, expected=201)
    tokens.append(call("POST", "/api/v1/auth/login", payload={"email": reader_email, "password": password})["access_token"])

empty = call("GET", "/api/v1/users/me/recommendations", tokens[1])
assert empty["status"] == "preferences_required" and empty["count"] == 0
genre = call("POST", "/api/v1/genres", staff, {"name": "fantasy"})["id"]
call("PUT", "/api/v1/users/me/preferences/genres", tokens[0], {"genre_ids": [genre]})
initial = call("GET", "/api/v1/users/me/recommendations?limit=10", tokens[0])
assert initial["status"] == "ok" and initial["count"] >= 3
assert all(not item["in_local_catalog"] for item in initial["recommendations"])
first, second = initial["recommendations"][:2]
local1 = call("POST", "/api/v1/books", staff, {"title": "Local mirror: " + (first["title"] or "Untitled"), "goodreads_book_id": first["goodreads_book_id"]}, 201)["id"]
local2 = call("POST", "/api/v1/books", staff, {"title": "Local mirror without copies", "goodreads_book_id": second["goodreads_book_id"]}, 201)["id"]
call("POST", f"/api/v1/books/{local1}/copies", staff, {"inventory_code": str(uuid.uuid4())})
enriched = call("GET", "/api/v1/users/me/recommendations?limit=10", tokens[0])
a, b, external = enriched["recommendations"][:3]
assert a["local_book_id"] == local1 and a["available"] is True
assert b["local_book_id"] == local2 and b["available"] is False and b["total_copies"] == 0
assert external["local_book_id"] is None and external["available"] is None
assert [r["goodreads_book_id"] for r in initial["recommendations"]] == [r["goodreads_book_id"] for r in enriched["recommendations"]]
similar = call("GET", f"/api/v1/books/{local1}/similar?limit=10", tokens[0])
assert similar["recommendation_type"] == "similar" and similar["model_version"] == "v2"
call("PUT", f"/api/v1/users/me/ratings/{local1}", tokens[0], {"rating": 5})
with_rating = call("GET", "/api/v1/users/me/recommendations?limit=10", tokens[0])
assert with_rating["status"] == "ok"
unmapped = call("POST", "/api/v1/books", staff, {"title": "No external mapping"}, 201)["id"]
call("GET", f"/api/v1/books/{unmapped}/similar", tokens[0], expected=409)
missing = call("POST", "/api/v1/books", staff, {"title": "Unknown Goodreads reference", "goodreads_book_id": "not-in-v2-artifacts"}, 201)["id"]
call("GET", f"/api/v1/books/{missing}/similar", tokens[0], expected=404)
call("GET", "/api/v1/users/me/recommendations?limit=51", tokens[0], expected=400)

# Comprueba aislamiento de fallos con otra instancia Go del mismo backend.
bad_container = "alejandria-recommendation-fault-smoke"
compose = ["docker", "compose", "--env-file", os.environ.get("COMPOSE_ENV_FILE", ".env")]
subprocess.run(compose + ["run", "-d", "--no-deps", "--name", bad_container, "-p", "127.0.0.1:18081:8080", "-e", "APP_DATABASE_NAME=" + env["APP_DATABASE_NAME"], "-e", "APP_RECOMMENDATION_URL=http://127.0.0.1:1", "backend"], check=True, stdout=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            urllib.request.urlopen("http://127.0.0.1:18081/health", timeout=1).close()
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.RemoteDisconnected):
            time.sleep(0.1)
    call("GET", "/api/v1/users/me/recommendations", tokens[0], expected=503, server="http://127.0.0.1:18081")
    call("GET", "/api/v1/auth/me", tokens[0], server="http://127.0.0.1:18081")
finally:
    subprocess.run(["docker", "rm", "-f", bad_container], check=True, stdout=subprocess.DEVNULL)

memory = json.loads(subprocess.check_output(["docker", "exec", inference_container, "python", "-c", "import json; from pathlib import Path; s=Path('/proc/1/status').read_text().splitlines(); print(json.dumps({x.split(':')[0]:int(x.split()[1])*1024 for x in s if x.startswith(('VmRSS:','VmHWM:'))}))"]))
info = json.loads(subprocess.check_output(["docker", "inspect", inference_container]))[0]
logs = subprocess.run(["docker", "logs", "--timestamps", inference_container], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True).stdout.decode()
startup = None
for line in logs.splitlines():
    if "Application startup complete" in line:
        started = datetime.datetime.fromisoformat(info["State"]["StartedAt"].replace("Z", "+00:00"))
        ready = datetime.datetime.fromisoformat(line.split()[0].replace("Z", "+00:00"))
        startup = (ready - started).total_seconds()
        break
print(json.dumps({"result": "passed", "startup_seconds": startup, "inference_memory_bytes": memory, "timings": timings, "real_examples": enriched["recommendations"][:3], "similar_example": similar["recommendations"][:1]}, indent=2, ensure_ascii=False))
