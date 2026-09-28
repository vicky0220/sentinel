import os
import cv2
import csv
import json
import base64
import time
import hashlib
import logging
import requests
import threading
from collections import defaultdict
from datetime import datetime, timezone
from ultralytics import YOLO
from flask import Flask, Response
from flask_cors import CORS

from google.oauth2 import service_account
import google.auth.transport.requests
import firebase_admin
from firebase_admin import credentials, db

# ==============================================================================
# CONFIGURATION & CONSTANTS
# ==============================================================================
logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s: %(message)s')

FIREBASE_DB_URL = "https://cctv-b93f0-default-rtdb.firebaseio.com"
CAMERA_ID = "cam06"
VIDEO_FILENAME = "cam_06.mp4"
REPORT_CSV_PATH = "sentinel_cam06_report.csv"

# Classes: Person(0), Bicycle(1), Car(2), Motorcycle(3), Bus(5), Truck(7)
TARGET_CLASSES = [0, 1, 2, 3, 5, 7]

GCP_PROJECT_ID = "swing-trade-bot-504408"
GCP_REGION = "us-central1"
SERVICE_ACCOUNT_JSON = "gcp-key.json"
FIREBASE_KEY_JSON = "firebase-key.json"

API_COOLDOWN_SECONDS = 2.5
last_api_call_time = 0

# ==============================================================================
# FIREBASE ADMIN INITIALIZATION
# ==============================================================================
if not firebase_admin._apps:
    try:
        cred = credentials.Certificate(FIREBASE_KEY_JSON)
        firebase_admin.initialize_app(cred, {'databaseURL': FIREBASE_DB_URL})
        logging.info("🔥 Firebase Admin SDK initialized.")
    except Exception as e:
        logging.warning(f"⚠️ Firebase Admin init skipped/failed: {e}")

# ==============================================================================
# FLASK REAL-TIME STREAMING SERVER (Port 5001)
# ==============================================================================
app = Flask(__name__)
CORS(app)

current_annotated_frame = None
frame_lock = threading.Lock()

def generate_web_feed():
    global current_annotated_frame
    while True:
        with frame_lock:
            if current_annotated_frame is None:
                time.sleep(0.01)
                continue
            ret, buffer = cv2.imencode('.jpg', current_annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if not ret:
                continue
            frame_bytes = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.033)

@app.route('/anpr_feed')
def anpr_feed():
    return Response(generate_web_feed(), mimetype='multipart/x-mixed-replace; boundary=frame')

def start_flask():
    app.run(host='0.0.0.0', port=5001, threaded=True, debug=False, use_reloader=False)

threading.Thread(target=start_flask, daemon=True).start()

# ==============================================================================
# GCP AUTHENTICATION & DOSSIER GENERATION
# ==============================================================================
gcp_creds = None
auth_req = None
try:
    gcp_creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_JSON,
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    auth_req = google.auth.transport.requests.Request()
except Exception as e:
    logging.warning(f"Notice: gcp-key.json not loaded ({e}).")

def generate_mock_rto_dossier(plate_number, helmet_compliant=True):
    if plate_number == "UNREADABLE":
        return None
    hash_val = int(hashlib.md5(plate_number.encode()).hexdigest(), 16)
    insurance_valid = (hash_val % 100) > 30
    has_challans = (hash_val % 100) < 40

    dossier = {
        "registration_status": "ACTIVE",
        "insurance_status": "VALID" if insurance_valid else "EXPIRED",
        "pucc_status": "VALID" if (hash_val % 10) > 2 else "EXPIRED",
        "pending_challans": [],
        "total_fine_amount": 0
    }
    if not insurance_valid:
        dossier["total_fine_amount"] += 2000
    if has_challans:
        dossier["pending_challans"].append({"reason": "Signal Violation", "amount": 1000})
        dossier["total_fine_amount"] += 1000

    if not helmet_compliant:
        dossier["pending_challans"].append({"reason": "No Helmet (Sec 129 MVA)", "amount": 1000})
        dossier["total_fine_amount"] += 1000

    return dossier

# ==============================================================================
# SMART EXPANDED CROP (Ensures Full Rider Head + Bike is Captured)
# ==============================================================================
def get_full_rider_crop(frame, box, cls):
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = box
    
    # If motorcycle (3) or bicycle (1), expand UPWARDS to capture the head/helmet
    if cls in [1, 3]:
        box_h = y2 - y1
        expanded_y1 = max(0, int(y1 - (box_h * 0.70)))
        expanded_y2 = min(h, int(y2 + (box_h * 0.10)))
        expanded_x1 = max(0, int(x1 - (box_h * 0.15)))
        expanded_x2 = min(w, int(x2 + (box_h * 0.15)))
        return frame[expanded_y1:expanded_y2, expanded_x1:expanded_x2]
    # If person (0), expand DOWNWARDS to capture the full motorcycle
    elif cls == 0:
        box_h = y2 - y1
        expanded_y1 = max(0, int(y1 - (box_h * 0.15)))
        expanded_y2 = min(h, int(y2 + (box_h * 0.75)))
        expanded_x1 = max(0, int(x1 - (box_h * 0.20)))
        expanded_x2 = min(w, int(x2 + (box_h * 0.20)))
        return frame[expanded_y1:expanded_y2, expanded_x1:expanded_x2]
    else:
        return frame[max(0, y1):min(h, y2), max(0, x1):min(w, x2)]

# ==============================================================================
# VERTEX AI INFERENCE (NORMAL TRAFFIC CORRIDOR)
# ==============================================================================
def analyze_vehicle_with_gemini(bgr_image, track_id, clarity_score):
    try:
        if not gcp_creds: return
        gcp_creds.refresh(auth_req)
        
        _, buffer = cv2.imencode('.jpg', bgr_image, [cv2.IMWRITE_JPEG_QUALITY, 92])
        image_base64 = base64.b64encode(buffer).decode('utf-8')
        image_data_uri = f"data:image/jpeg;base64,{image_base64}"

        prompt_text = (
            "Analyze this vehicle snapshot from an Indian surveillance camera.\n"
            "INDIAN RTO SYNTAX: [State: 2 letters][RTO: 2 digits][Series: 1-3 letters][Number: 4 digits].\n"
            "Return a strictly valid JSON object with keys:\n"
            "1. 'plate_number': Alphanumeric string with no spaces or 'UNREADABLE'.\n"
            "2. 'confidence_score': Float between 0.00 and 1.00.\n"
            "3. 'make': Vehicle manufacturer.\n"
            "4. 'model': Vehicle model name.\n"
            "5. 'vehicle_type': Category ('Car', 'SUV', 'Motorcycle', 'Scooter', 'Truck', 'Bus').\n"
            "6. 'color': Dominant exterior color.\n"
            "7. 'helmet_compliant': Boolean (true/false). If this is a two-wheeler and the rider is NOT wearing a helmet, set strictly to false. Otherwise true."
        )

        payload = {
            "contents": [{"role": "user", "parts": [
                {"text": prompt_text},
                {"inlineData": {"mimeType": "image/jpeg", "data": image_base64}}
            ]}],
            "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
        }

        headers = {'Authorization': f'Bearer {gcp_creds.token}', 'Content-Type': 'application/json'}
        url = f"https://{GCP_REGION}-aiplatform.googleapis.com/v1/projects/{GCP_PROJECT_ID}/locations/{GCP_REGION}/publishers/google/models/gemini-2.5-flash:generateContent"
        
        response = requests.post(url, headers=headers, json=payload, timeout=12)
        if response.status_code == 200:
            cloud_data = json.loads(response.json()['candidates'][0]['content']['parts'][0]['text'])

            plate = cloud_data.get('plate_number', 'UNREADABLE').strip().upper()
            v_type = cloud_data.get('vehicle_type', 'Motorcycle')
            color = cloud_data.get('color', 'Unknown')
            ai_confidence = float(cloud_data.get('confidence_score', 0.0))
            helmet_compliant = cloud_data.get('helmet_compliant', True)

            dossier = generate_mock_rto_dossier(plate, helmet_compliant=helmet_compliant)
            timestamp_iso = datetime.now(timezone.utc).isoformat()

            # Push standard transit
            requests.post(f"{FIREBASE_DB_URL}/transits.json", json={
                "camera_id": CAMERA_ID,
                "plate_number": plate,
                "entity_type": v_type,
                "color": color,
                "confidence": ai_confidence,
                "clarity_score": clarity_score,
                "helmet_compliant": helmet_compliant,
                "image_data": image_data_uri,
                "rto_dossier": dossier,
                "timestamp_utc": timestamp_iso
            }, timeout=4)

            # Fire safety alert if rider is without a helmet
            if not helmet_compliant:
                requests.post(f"{FIREBASE_DB_URL}/alerts.json", json={
                    "camera_id": CAMERA_ID,
                    "plate_number": plate if plate != "UNREADABLE" else f"RIDER-{track_id}",
                    "entity_type": v_type,
                    "color": color,
                    "reason": "NO HELMET (Sec 129 MVA) | Fine: ₹1,000",
                    "helmet_compliant": False,
                    "timestamp_utc": timestamp_iso,
                    "image_data": image_data_uri,
                    "rto_dossier": dossier
                }, timeout=3)
                logging.warning(f"🚨🚨 [HELMET VIOLATION] Track ID {track_id} | Issued Section 129 Challan 🚨🚨")

            logging.info(f"✅ ANPR Logged for Track ID {track_id}: {plate} (Helmet: {helmet_compliant})")
    except Exception as err:
        logging.debug(f"Gemini ANPR note: {err}")

# ==============================================================
# EDGE TRACKER ENGINE (WITH COMPOUND OFFENSE STACKING)
# ==============================================================
class SentinelEdgeCam06:
    def __init__(self):
        logging.info("Initializing YOLOv8 Edge Tracker for CAM06...")
        self.yolo_model = YOLO("yolov8n.pt")
        self.processed_track_ids = set()
        self.track_history = defaultdict(lambda: [])
        self.wrong_way_alerted = set()

    def calculate_clarity(self, image):
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            variance = cv2.Laplacian(gray, cv2.CV_64F).var()
            return int(min(98, max(38, (variance / 4.5) + 32)))
        except Exception:
            return 85

    def trigger_wrong_way_alert(self, frame, track_id, box, cls):
        # 1. Full Vehicle Crop (Using Smart Expanded Logic)
        crop_img = get_full_rider_crop(frame, box, cls)

        image_data_uri = None
        if crop_img.size > 0:
            ret, buffer = cv2.imencode('.jpg', crop_img, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if ret:
                image_data_uri = "data:image/jpeg;base64," + base64.b64encode(buffer).decode('utf-8')

        v_type_map = {0: 'Rider', 1: 'Bicycle', 2: 'Car', 3: 'Motorcycle', 5: 'Bus', 7: 'Truck'}
        v_type = v_type_map.get(cls, 'Vehicle')

        # Baseline Violation
        reasons = ["WRONG-WAY DRIVING (Sec 184 MVA)"]
        total_fine = 1500
        alert_prefix = "WRONG-WAY INTERCEPT"
        helmet_compliant = True

        # ---------------------------------------------------------
        # 2. HELMET COMPLIANCE CHECK FOR WRONG-WAY DRIVER
        # ---------------------------------------------------------
        if cls in [0, 1, 3] and crop_img.size > 0 and gcp_creds:
            try:
                gcp_creds.refresh(auth_req)
                prompt = (
                    "Analyze this cropped surveillance image of a rider. "
                    "Is the rider wearing a motorcycle safety helmet? "
                    "Return strict JSON: {'helmet_detected': true/false}"
                )
                payload = {
                    "contents": [{"role": "user", "parts": [
                        {"text": prompt},
                        {"inlineData": {"mimeType": "image/jpeg", "data": image_data_uri.split(",")[1]}}
                    ]}],
                    "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
                }
                headers = {'Authorization': f'Bearer {gcp_creds.token}', 'Content-Type': 'application/json'}
                url = f"https://{GCP_REGION}-aiplatform.googleapis.com/v1/projects/{GCP_PROJECT_ID}/locations/{GCP_REGION}/publishers/google/models/gemini-2.5-flash:generateContent"

                resp = requests.post(url, headers=headers, json=payload, timeout=5)
                if resp.status_code == 200:
                    res_json = json.loads(resp.json()['candidates'][0]['content']['parts'][0]['text'])
                    if not res_json.get('helmet_detected', True):
                        reasons.append("NO HELMET (Sec 129 MVA)")
                        total_fine += 500
                        alert_prefix = "COMPOUND VIOLATION"
                        helmet_compliant = False
            except Exception as e:
                logging.debug(f"Upper head crop check: {e}")

        # 3. Dispatch Consolidated E-Challan Alert
        reason_str = " + ".join(reasons) + f" | Total Fine: ₹{total_fine}"

        payload = {
            "camera_id": CAMERA_ID,
            "plate_number": f"TARGET-{track_id}",
            "entity_type": v_type,
            "color": "Unknown",
            "reason": reason_str,
            "helmet_compliant": helmet_compliant,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "image_data": image_data_uri,
            "rto_dossier": generate_mock_rto_dossier(f"TARGET-{track_id}", helmet_compliant)
        }

        try:
            requests.post(f"{FIREBASE_DB_URL}/alerts.json", json=payload, timeout=3)
            logging.warning(f"🚨🚨 [{alert_prefix}] Track ID {track_id} | Compounded Penalty: ₹{total_fine} 🚨🚨")
        except Exception as err:
            logging.error(f"Firebase alert error: {err}")

    def run(self):
        global last_api_call_time, current_annotated_frame

        cap = cv2.VideoCapture("cam_06.mp4")
        if not cap.isOpened():
            logging.error("❌ Cannot open video feed")
            return

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frame_duration = 1.0 / fps

        while True:
            start_time = time.time()
            ret, frame = cap.read()
            if not ret:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue

            h, w = frame.shape[:2]
            trigger_y = int(h * 0.75)

            # ANPR Corridor Line
            cv2.line(frame, (0, trigger_y), (w, trigger_y), (0, 165, 255), 2)
            cv2.putText(frame, "ANPR RECOGNITION CORRIDOR (75%)", (15, trigger_y - 12),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)

            results = self.yolo_model.track(
                frame, persist=True, classes=TARGET_CLASSES, conf=0.15, imgsz=640, verbose=False
            )[0]

            if results.boxes is not None and results.boxes.id is not None:
                boxes = results.boxes.xyxy.cpu().numpy().astype(int)
                track_ids = results.boxes.id.cpu().numpy().astype(int)
                classes = results.boxes.cls.cpu().numpy().astype(int)

                for box, track_id, cls in zip(boxes, track_ids, classes):
                    x1, y1, x2, y2 = box
                    cx, cy = float((x1 + x2) / 2), float((y1 + y2) / 2)

                    track = self.track_history[track_id]
                    track.append((cx, cy))
                    if len(track) > 30: track.pop(0)

                    # ----------------------------------------------------------
                    # 1. WRONG-WAY VECTOR MATH (Moving UP: dy < -45)
                    # ----------------------------------------------------------
                    is_wrong_way = False
                    if len(track) >= 15:
                        dy = track[-1][1] - track[0][1]
                        if dy < -45:
                            is_wrong_way = True
                            if track_id not in self.wrong_way_alerted:
                                self.wrong_way_alerted.add(track_id)
                                threading.Thread(
                                    target=self.trigger_wrong_way_alert,
                                    args=(frame.copy(), track_id, box, cls),
                                    daemon=True
                                ).start()

                    # Render UI Bounding Box
                    if is_wrong_way or track_id in self.wrong_way_alerted:
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
                        cv2.putText(frame, "COMPOUND ALERT", (x1, max(20, y1 - 25)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                    else:
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 120), 2)
                        cv2.putText(frame, f"TRACK ID:{track_id}", (x1, max(20, y1 - 8)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 120), 2)

                    # ----------------------------------------------------------
                    # 2. NORMAL FLOW ANPR
                    # ----------------------------------------------------------
                    if not is_wrong_way and y2 > trigger_y and track_id not in self.processed_track_ids:
                        current_time = time.time()
                        if current_time - last_api_call_time >= API_COOLDOWN_SECONDS:
                            self.processed_track_ids.add(track_id)
                            last_api_call_time = current_time

                            vehicle_crop = get_full_rider_crop(frame, box, cls)
                            if vehicle_crop.size > 0:
                                clarity = self.calculate_clarity(vehicle_crop)
                                threading.Thread(
                                    target=analyze_vehicle_with_gemini,
                                    args=(vehicle_crop, track_id, clarity),
                                    daemon=True
                                ).start()
                        else:
                            self.processed_track_ids.add(track_id)

            with frame_lock:
                current_annotated_frame = frame.copy()

            elapsed = time.time() - start_time
            sleep_time = frame_duration - elapsed
            if sleep_time > 0: time.sleep(sleep_time)

        cap.release()

if __name__ == "__main__":
    engine = SentinelEdgeCam06()
    engine.run()