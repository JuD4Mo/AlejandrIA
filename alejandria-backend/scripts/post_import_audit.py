"""Validación HTTP real sobre catálogo importado y PostgreSQL test_* exclusivamente.

No usa fixtures operativas. Credenciales aleatorias solo en memoria; evidencia sin
tokens ni emails. Requiere catálogo real importado, contenedor Go de prueba y FastAPI.
"""
from __future__ import annotations

import argparse
import datetime as dt
import http.client
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import psycopg

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src/data"))
from audit_catalog import operational_snapshot
from import_catalog import atomic_json


def verified_import_environment(conn):
    """No heredar una CATALOG_DATABASE_URL ajena a la conexión test_* verificada."""
    if not conn.info.dbname.startswith("test_"):
        raise ValueError("Refusing non-test reimport destination")
    environment = os.environ.copy()
    environment["PGDATABASE"] = conn.info.dbname
    environment["CATALOG_DATABASE_URL"] = psycopg.conninfo.make_conninfo(conn.info.dsn, password=conn.info.password)
    return environment


def run(args):
    report = {"status": "running", "checks": {}, "requests": [], "external_covers": []}
    def require(condition, name):
        if not condition:
            raise AssertionError(name)
        report["checks"][name] = True
    def call(method, path, token=None, body=None, expected=200, base=args.url):
        request = urllib.request.Request(base + "/api/v1" + path, data=None if body is None else json.dumps(body).encode(), method=method, headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})})
        start = time.perf_counter()
        try:
            response = urllib.request.urlopen(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            payload = json.load(response)
            report["requests"].append({"method": method, "path": path, "status": response.code, "expected": expected, "milliseconds": (time.perf_counter()-start)*1000})
            if response.code != expected:
                raise AssertionError(f"{method} {path}: got {response.code}, expected {expected}, code={payload.get('code')}")
            return payload
    def inference(preferences):
        code = "import json,sys,urllib.request; p=sys.stdin.buffer.read(); r=urllib.request.Request('http://localhost:8000/api/v1/recommendations/preferences',data=p,headers={'Content-Type':'application/json'}); print(urllib.request.urlopen(r,timeout=30).read().decode())"
        return json.loads(subprocess.check_output(["docker","exec","-i",args.inference_container,"python","-c",code], input=json.dumps({"preferences": preferences,"limit":10}).encode()))

    with psycopg.connect(os.getenv("CATALOG_TEST_DATABASE_URL", ""), autocommit=True) as conn:
        if not conn.info.dbname.startswith("test_"):
            raise ValueError("Refusing a non-test database")
        env = dict(value.split("=",1) for value in json.loads(subprocess.check_output(["docker","inspect",args.container]))[0]["Config"]["Env"])
        if env["APP_DATABASE_NAME"] != conn.info.dbname:
            raise ValueError("API container and database do not match")
        if conn.execute("SELECT count(*) FROM users").fetchone()[0] != 0:
            raise ValueError("Use a fresh disposable database without users")
        initial_books = conn.execute("SELECT count(*) FROM books").fetchone()[0]
        require(initial_books > 10000, "real_imported_catalog_present")
        password = secrets.token_urlsafe(24)
        admin_email = f"audit-{uuid.uuid4()}@synthetic.invalid"
        subprocess.run(["docker","exec","-i",args.container,"/app/admin"], input=json.dumps({"email":admin_email,"display_name":"Audit admin","password":password}).encode(), check=True)
        try:
            staff = call("POST","/auth/login",body={"email":admin_email,"password":password})["access_token"]
            admin_id = call("GET","/auth/me",staff)["id"]
            identities = []
            for _ in range(4):
                email = f"audit-reader-{uuid.uuid4()}@synthetic.invalid"
                u = call("POST","/auth/register",body={"email":email,"display_name":"Audit reader","password":password},expected=201)
                require(u["roles"] == ["lector"] and "password_hash" not in u, "registration_reader_only_no_hash")
                token = call("POST","/auth/login",body={"email":email,"password":password})["access_token"]
                identities.append((u["id"],token,email))
            aid,a,_ = identities[0]; bid,b,_ = identities[1]; cid,c,_ = identities[2]; lid,_,lib_email = identities[3]
            call("PUT",f"/users/{lid}/roles",staff,{"roles":["bibliotecario"]})
            lib = call("POST","/auth/login",body={"email":lib_email,"password":password})["access_token"]
            call("GET","/users/me/recommendations",lib,expected=403)
            call("GET","/users",a,expected=403)
            call("PUT",f"/users/{aid}/roles",a,{"roles":["administrador"]},expected=403)
            call("POST","/auth/register",body={"email":"not-created@example.org","display_name":"Invalid","password":password,"roles":["administrador"]},expected=400)
            call("GET","/auth/me",a+"x",expected=401)
            call("GET","/books",expected=401)
            call("POST","/books",a,{"title":"Forbidden"},expected=403)
            require(call("GET","/auth/me",a)["id"] == aid, "JWT_identity")

            # Catálogo completo, metadatos y cursores: no se crean espejos bibliográficos.
            page1 = call("GET","/books?limit=20",a)
            page2 = call("GET",f"/books?limit=20&after_id={page1['next_after_id']}",a)
            offset2 = call("GET","/books?limit=20&offset=20",a)
            require(set(x["id"] for x in page1["data"]).isdisjoint(x["id"] for x in page2["data"]), "cursor_no_duplicates")
            require([x["id"] for x in page2["data"]] == [x["id"] for x in offset2["data"]], "offset_cursor_agree")
            call("GET","/books?after_id=1&offset=1",a,expected=400)
            harry = call("GET","/books?title=Harry%20Potter&limit=20",a)
            require(len(harry["data"])>0, "title_search_real_catalog")
            selected = call("GET",f"/books/{harry['data'][0]['id']}",a)
            author = selected["authors"][0]["author_id"]; genre = selected["genre_ids"][0]
            filtered = call("GET",f"/books?author_id={author}&genre_id={genre}&limit=20",a)
            require(bool(filtered["data"]) and all(genre in row["genre_ids"] and any(x["author_id"]==author for x in row["authors"]) for row in filtered["data"]), "author_genre_filters")
            values = conn.execute("SELECT goodreads_book_id,title,description,isbn,isbn13,language_code,publication_year,num_pages,image_url FROM books WHERE id=%s",(selected["id"],)).fetchone()
            keys = ("goodreads_book_id","title","description","isbn","isbn13","language_code","publication_year","num_pages","image_url")
            require(all(selected[k] == v for k,v in zip(keys,values)), "API_metadata_matches_PostgreSQL")
            require(isinstance(selected["goodreads_book_id"],str) and bool(selected["image_url"]), "Goodreads_string_and_cover_metadata")
            for image in [selected["image_url"]]:
                try:
                    with urllib.request.urlopen(urllib.request.Request(image,method="HEAD"),timeout=5) as resp:
                        report["external_covers"].append({"status":resp.code,"content_type":resp.headers.get("Content-Type")})
                except Exception as error:
                    report["external_covers"].append({"error_type":type(error).__name__,"http_status":getattr(error,"code",None)})

            # Preferencias y scores: comparar respuesta Python directa con Go, antes de enriquecer.
            fantasy = conn.execute("SELECT id,name FROM genres WHERE name=%s",("fantasy, paranormal",)).fetchone()
            require(call("GET","/users/me/recommendations",a)["status"]=="preferences_required", "empty_reader_no_invented_scores")
            call("PUT","/users/me/preferences/genres",a,{"genre_ids":[fantasy[0]]})
            prefs = {"genres":[fantasy[1]],"authors":[],"keywords":[]}
            raw = inference(prefs); enriched = call("GET","/users/me/recommendations?limit=10",a)
            require([x["book_id"] for x in raw["recommendations"]] == [x["goodreads_book_id"] for x in enriched["recommendations"]], "ranking_order_preserved")
            require(all(x["score"]==y["score"] and x["model"]==y["model"] and x["score_scope"]==y["score_scope"] for x,y in zip(raw["recommendations"],enriched["recommendations"])), "original_scores_unchanged")
            rows = {r[1]:r[0] for r in conn.execute("SELECT id,goodreads_book_id FROM books WHERE goodreads_book_id=ANY(%s::text[])",([x["book_id"] for x in raw["recommendations"]],))}
            for item in enriched["recommendations"]:
                local = rows.get(item["goodreads_book_id"])
                require(item["local_book_id"]==local and item["in_local_catalog"]==(local is not None), "exact_Goodreads_correspondence")
                require(item["available"] is (False if local is not None else None), "recommendations_zero_inventory")
            report["recommendations"] = {"returned":enriched["count"],"matched":len(rows),"unmatched":[x["goodreads_book_id"] for x in enriched["recommendations"] if not x["in_local_catalog"]],"samples":enriched["recommendations"][:3]}
            matched = [x for x in enriched["recommendations"] if x["in_local_catalog"]]
            require(len(matched)>=4, "at_least_four_real_imported_books_for_workflow")
            A,B,C,D = [x["local_book_id"] for x in matched[:4]]
            first_rating = call("PUT",f"/users/me/ratings/{A}",a,{"rating":4})
            updated = call("PUT",f"/users/me/ratings/{A}",a,{"rating":5})
            require(first_rating["created_at"]==updated["created_at"] and updated["updated_at"]>=first_rating["updated_at"], "rating_timestamps")
            call("POST","/users/me/interactions",a,{"book_id":A,"interaction_type":"recommendation_click"},expected=201)
            require(len(call("GET","/users/me/ratings",a)["data"])==1 and len(call("GET","/users/me/interactions",a)["data"])==1, "rating_click_persisted_without_copies")
            require(call("GET","/users/me/ratings",b)["data"]==[] and call("GET","/users/me/interactions",b)["data"]==[], "private_reader_data_isolated")
            call("PUT",f"/users/me/ratings/{A}",b,{"rating":3,"user_id":aid},expected=400)
            call("POST","/users/me/interactions",a,{"book_id":A,"interaction_type":"loan"},expected=400)
            raw2 = inference({**prefs,"keywords":[matched[0]["title"]]}); go2 = call("GET","/users/me/recommendations?limit=10",a)
            require([(x["book_id"],x["score"]) for x in raw2["recommendations"]]==[(x["goodreads_book_id"],x["score"]) for x in go2["recommendations"]], "positive_rating_profile_matches_raw_inference")
            similar = call("GET",f"/books/{A}/similar?limit=5",a)
            require(similar["model_version"]=="v2" and similar["recommendation_type"]=="similar", "real_similar_endpoint")

            # Circulación sobre esas mismas ediciones importadas.
            call("POST","/loan-requests",a,{"book_id":A},expected=409)
            call("POST","/reservations",a,{"book_id":A},expected=409)
            copyA = call("POST",f"/books/{A}/copies",lib,{"inventory_code":str(uuid.uuid4())})["id"]
            call("POST",f"/books/{B}/copies",a,{"inventory_code":str(uuid.uuid4())},expected=403)
            require(call("GET",f"/books/{A}",a)["available_copies"]==1, "imported_book_now_available")
            request = call("POST","/loan-requests",a,{"book_id":A},expected=201)["id"]
            call("POST","/loan-requests",a,{"book_id":A},expected=409)
            call("POST",f"/loan-requests/{request}/deliver",a,{"copy_id":copyA},expected=403)
            loan = call("POST",f"/loan-requests/{request}/deliver",lib,{"copy_id":copyA})
            delivered = conn.execute("SELECT delivered_at,initial_due_at FROM loans WHERE id=%s",(loan["id"],)).fetchone()
            require(delivered[1]-delivered[0]==dt.timedelta(days=30), "thirty_day_initial_loan")
            q1 = call("POST","/reservations",b,{"book_id":A},expected=201)
            q2 = call("POST","/reservations",c,{"book_id":A},expected=201)
            require(q1["status"]==q2["status"]=="waiting", "all_copies_loaned_still_reservable")
            call("POST","/reservations",b,{"book_id":A},expected=409)
            call("POST",f"/reservations/{q2['id']}/cancel",b,expected=403)
            require(all(row["user_id"]==bid for row in call("GET","/reservations",b)["data"]), "reservation_history_private")
            detail = call("GET",f"/books/{A}",a)
            require(detail["has_copies"] and detail["loaned_copies"]==1 and detail["available_copies"]==0, "loaned_not_absent_inventory")
            call("POST",f"/loans/{loan['id']}/return",a,expected=403)
            call("POST",f"/loans/{loan['id']}/return",lib)
            first_ready = conn.execute("SELECT status,assigned_by,assignment_origin,pickup_expires_at-assigned_at FROM reservations WHERE id=%s",(q1["id"],)).fetchone()
            require(first_ready==("ready",lid,"manual",dt.timedelta(hours=72)), "return_assigns_first_FIFO_with_actual_actor")
            steal = call("POST","/loan-requests",a,{"book_id":A},expected=201)["id"]
            call("POST",f"/loan-requests/{steal}/deliver",lib,{"copy_id":copyA},expected=409)
            pickup = call("POST",f"/reservations/{q1['id']}/pickup",lib)
            call("POST",f"/reservations/{q1['id']}/pickup",lib,expected=409)
            trace = conn.execute("SELECT r.status,q.status,q.user_id,r.loan_id FROM reservations r JOIN loans l ON l.id=r.loan_id JOIN loan_requests q ON q.id=l.request_id WHERE r.id=%s",(q1["id"],)).fetchone()
            require(trace==("fulfilled","approved",bid,pickup["id"]), "pickup_creates_approved_request_and_trace")
            call("POST",f"/loans/{pickup['id']}/return",lib)
            call("POST",f"/reservations/{q2['id']}/cancel",c)

            # Bloquear el libro permite verificar GET puros sin carrera con el worker.
            expiring = call("POST","/reservations",b,{"book_id":A},expected=201)
            waiting = call("POST","/reservations",c,{"book_id":A},expected=201)
            require(expiring["assignment_origin"]=="system" and expiring["assigned_by"] is None, "automatic_actor_not_impersonated")
            with psycopg.connect(os.getenv("CATALOG_TEST_DATABASE_URL", "")) as keeper:
                keeper.execute("SELECT id FROM books WHERE id=%s FOR UPDATE",(A,))
                conn.execute("UPDATE reservations SET created_at=created_at-interval '100 hours',assigned_at=assigned_at-interval '100 hours',pickup_expires_at=pickup_expires_at-interval '100 hours' WHERE id=%s",(expiring["id"],))
                before_get = conn.execute("SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM reservations r WHERE book_id=%s",(A,)).fetchone()[0]
                require(call("GET",f"/books/{A}/copies",a)["available"]==0, "GET_conservative_expired_hold")
                call("GET","/reservations",b)
                after_get = conn.execute("SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM reservations r WHERE book_id=%s",(A,)).fetchone()[0]
                require(before_get==after_get, "GET_does_not_process_expiration")
            wait_start = time.perf_counter()
            for _ in range(80):
                state = conn.execute("SELECT status FROM reservations WHERE id=%s",(waiting["id"],)).fetchone()[0]
                if state=="ready":break
                time.sleep(1)
            require(state=="ready", "actual_worker_expires_and_reassigns_FIFO")
            require(conn.execute("SELECT status FROM reservations WHERE id=%s",(expiring["id"],)).fetchone()[0]=="expired", "expiration_persisted")
            report["worker_expiration_seconds"] = time.perf_counter()-wait_start
            call("POST",f"/reservations/{waiting['id']}/cancel",c)

            # Máximo dos activos, aun con solicitudes previas y copias disponibles.
            copyB=call("POST",f"/books/{B}/copies",lib,{"inventory_code":str(uuid.uuid4())})["id"]
            copyC=call("POST",f"/books/{C}/copies",lib,{"inventory_code":str(uuid.uuid4())})["id"]
            pending=[call("POST","/loan-requests",c,{"book_id":book},expected=201)["id"] for book in (A,B,C)]
            l1=call("POST",f"/loan-requests/{pending[0]}/deliver",lib,{"copy_id":copyA})
            l2=call("POST",f"/loan-requests/{pending[1]}/deliver",lib,{"copy_id":copyB})
            call("POST",f"/loan-requests/{pending[2]}/deliver",lib,{"copy_id":copyC},expected=409)
            require(conn.execute("SELECT count(*) FROM loans WHERE user_id=%s AND returned_at IS NULL",(cid,)).fetchone()[0]==2, "two_active_loan_limit")
            renew=call("POST",f"/loans/{l2['id']}/renewals",c)["id"]
            call("POST",f"/renewals/{renew}/decision",lib,{"approve":True})
            call("POST",f"/loans/{l2['id']}/renewals",c,expected=409)
            with conn.transaction():
                conn.execute("UPDATE loans SET delivered_at=delivered_at-interval '90 days',initial_due_at=initial_due_at-interval '90 days',due_at=due_at-interval '90 days' WHERE id=%s",(l2["id"],))
                conn.execute("UPDATE loan_requests SET created_at=created_at-interval '90 days',decided_at=decided_at-interval '90 days' WHERE id=(SELECT request_id FROM loans WHERE id=%s)",(l2["id"],))
                conn.execute("UPDATE loan_renewals SET requested_at=requested_at-interval '90 days',previous_due_at=previous_due_at-interval '90 days',new_due_at=new_due_at-interval '90 days',decided_at=decided_at-interval '90 days' WHERE loan_id=%s",(l2["id"],))
            call("POST","/loan-requests",c,{"book_id":D},expected=409)
            call("POST",f"/loans/{l1['id']}/renewals",c,expected=409)
            require(all(row["user_id"]==aid for row in call("GET","/loans",a)["data"]), "loan_history_private")
            require(conn.execute("SELECT count(*) FROM(SELECT copy_id FROM loans WHERE returned_at IS NULL GROUP BY copy_id HAVING count(*)>1) d").fetchone()[0]==0, "no_double_active_loans")

            # Fallo real de persistencia después de aprobar: rollback de toda la entrega.
            copyD=call("POST",f"/books/{D}/copies",lib,{"inventory_code":str(uuid.uuid4())})["id"]
            qD=call("POST","/loan-requests",a,{"book_id":D},expected=201)["id"]
            conn.execute(f"CREATE FUNCTION audit_reject_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.book_id={int(D)} THEN RAISE EXCEPTION 'audit synthetic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER audit_reject_insert BEFORE INSERT ON loans FOR EACH ROW EXECUTE FUNCTION audit_reject_insert()")
            try:
                call("POST",f"/loan-requests/{qD}/deliver",lib,{"copy_id":copyD},expected=500)
                require(conn.execute("SELECT status FROM loan_requests WHERE id=%s",(qD,)).fetchone()[0]=="pending", "delivery_rollback_after_approval")
                require(conn.execute("SELECT count(*) FROM loans WHERE request_id=%s",(qD,)).fetchone()[0]==0, "failed_delivery_no_partial_loan")
            finally:
                conn.execute("DROP TRIGGER audit_reject_insert ON loans; DROP FUNCTION audit_reject_insert()")

            # La repetición ETL debe preservar también datos operativos ya existentes.
            manual=call("POST","/books",staff,{"title":"Manual audit record"},expected=201)["id"]
            original=call("GET",f"/books/{A}",a)
            payload={key:original[key] for key in ("title","work_id","goodreads_book_id","description","isbn","isbn13","language_code","publication_year","num_pages","image_url","authors","genre_ids")}
            payload.update(title="Curated audit title",description="Preserve manual correction")
            call("PUT",f"/books/{A}",staff,payload)
            before=operational_snapshot(conn)
            environment=verified_import_environment(conn)
            subprocess.run([sys.executable,"src/data/import_catalog.py","--restart","--batch-size","5000","--state-file",str(args.state_file),"--report",str(args.reimport_report)],cwd=ROOT,env=environment,check=True)
            require(operational_snapshot(conn)==before, "ETL_preserves_users_loans_reservations_ratings_and_copies")
            require(conn.execute("SELECT title,description FROM books WHERE id=%s",(A,)).fetchone()==("Curated audit title","Preserve manual correction"), "ETL_preserves_curated_metadata")
            require(conn.execute("SELECT goodreads_book_id FROM books WHERE id=%s",(manual,)).fetchone()[0] is None, "ETL_preserves_manual_book")
            repeat=json.loads(args.reimport_report.read_text())
            require(all(x==0 for x in repeat["delta"].values()) and all(p["affected"]==0 for p in repeat["phases"].values()), "full_reimport_idempotent")
            report["operational_preservation"]={k:v["count"] for k,v in before.items()}
            report["reimport_seconds"]=repeat["elapsed_seconds"]
            # Caída de inferencia sin detener el motor compartido ni tocar la base operativa.
            fault="alejandria-audit-fault"
            subprocess.run(["docker","compose","--env-file",args.compose_env,"run","-d","--no-deps","--name",fault,"-p","127.0.0.1:18081:8080","-e","APP_DATABASE_NAME="+conn.info.dbname,"-e","APP_RECOMMENDATION_URL=http://127.0.0.1:1","backend"],check=True,stdout=subprocess.DEVNULL)
            try:
                for _ in range(100):
                    try:
                        urllib.request.urlopen("http://127.0.0.1:18081/health",timeout=1).close();break
                    except (OSError,http.client.RemoteDisconnected):time.sleep(0.1)
                call("GET","/users/me/recommendations",a,expected=503,base="http://127.0.0.1:18081")
                call("GET","/auth/me",a,base="http://127.0.0.1:18081")
                call("GET","/loans",lib,base="http://127.0.0.1:18081")
                require(True,"inference_failure_does_not_disable_identity_or_circulation")
            finally:
                subprocess.run(["docker","rm","-f",fault],check=True,stdout=subprocess.DEVNULL)
            # Desactivación y token antiguo.
            call("PATCH",f"/users/{bid}/active",staff,{"is_active":False})
            call("GET","/auth/me",b,expected=401)
            report["status"]="passed"
        except Exception as error:
            report["status"]="failed";report["failure"]={"type":type(error).__name__,"message":str(error)}
            raise
        finally:
            atomic_json(args.report,report)
            print(json.dumps({"status":report["status"],"checks":report["checks"],"failure":report.get("failure")},indent=2))


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url",default="http://127.0.0.1:18080")
    p.add_argument("--container",default="alejandria-audit-backend")
    p.add_argument("--inference-container",default="alejandria-recommendations-1")
    p.add_argument("--compose-env",default=".env")
    p.add_argument("--report",type=Path,required=True)
    p.add_argument("--state-file",type=Path,required=True)
    p.add_argument("--reimport-report",type=Path,required=True)
    run(p.parse_args())
