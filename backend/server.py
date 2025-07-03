from fastapi import FastAPI, APIRouter, File, UploadFile, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timedelta
import base64
import io
import re
import requests
import json

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Google Vision API configuration
GOOGLE_VISION_API_KEY = "AIzaSyCioKTG9FZmhCO5LuZBxo3es6_j8wPupis"
GOOGLE_VISION_URL = f"https://vision.googleapis.com/v1/images:annotate?key={GOOGLE_VISION_API_KEY}"

# Parking Configuration
HOURLY_RATE = 20  # ₹20 per hour

# Define Models
class ParkingRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    vehicle_number: str
    entry_time: datetime
    exit_time: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    total_fee: Optional[float] = None
    status: str = "PARKED"  # PARKED, EXITED

class ParkingRecordCreate(BaseModel):
    vehicle_number: str

class ParkingExit(BaseModel):
    vehicle_number: str

class OCRResult(BaseModel):
    vehicle_number: Optional[str] = None
    confidence: float = 0.0
    all_text: List[str] = []

def extract_license_plate_text(texts):
    """Extract potential license plate text from OCR results"""
    if not texts:
        return None, 0.0
    
    for text_annotation in texts:
        if 'description' in text_annotation:
            text = text_annotation['description']
            # Clean the text
            cleaned_text = re.sub(r'[^A-Z0-9]', '', text.upper())
            
            # Indian license plate patterns
            patterns = [
                r'^[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}$',  # Format: MH12AB1234
                r'^[A-Z]{2}[0-9]{2}[A-Z]{1}[0-9]{4}$',   # Format: MH12A1234
                r'^[A-Z]{2}[0-9]{2}[0-9]{4}$',           # Format: MH121234
                r'^[A-Z0-9]{6,10}$'                      # General alphanumeric
            ]
            
            for pattern in patterns:
                if re.match(pattern, cleaned_text) and len(cleaned_text) >= 6:
                    return cleaned_text, 0.9
    
    # If no license plate pattern found, return the first text with reasonable length
    for text_annotation in texts:
        if 'description' in text_annotation:
            text = text_annotation['description']
            cleaned_text = re.sub(r'[^A-Z0-9]', '', text.upper())
            if len(cleaned_text) >= 6:
                return cleaned_text, 0.7
    
    return None, 0.0

def calculate_parking_fee(entry_time: datetime, exit_time: datetime) -> tuple:
    """Calculate parking duration and fee"""
    duration = exit_time - entry_time
    duration_minutes = int(duration.total_seconds() / 60)
    
    # Calculate fee - minimum 1 hour charge
    hours = max(1, duration_minutes / 60)
    fee = HOURLY_RATE * hours
    
    return duration_minutes, fee

@api_router.post("/ocr/analyze", response_model=OCRResult)
async def analyze_image(file: UploadFile = File(...)):
    """Analyze uploaded image for license plate using Google Vision API"""
    try:
        # Read image file
        contents = await file.read()
        image_base64 = base64.b64encode(contents).decode('utf-8')
        
        # Prepare request for Google Vision API
        request_data = {
            "requests": [
                {
                    "image": {
                        "content": image_base64
                    },
                    "features": [
                        {
                            "type": "TEXT_DETECTION",
                            "maxResults": 10
                        }
                    ]
                }
            ]
        }
        
        # Call Google Vision API
        response = requests.post(GOOGLE_VISION_URL, json=request_data)
        
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Google Vision API error: {response.text}")
        
        result = response.json()
        
        # Extract text annotations
        text_annotations = []
        all_text = []
        
        if 'responses' in result and result['responses']:
            annotations = result['responses'][0].get('textAnnotations', [])
            for annotation in annotations:
                text_annotations.append(annotation)
                all_text.append(annotation.get('description', ''))
        
        # Extract license plate
        vehicle_number, confidence = extract_license_plate_text(text_annotations)
        
        return OCRResult(
            vehicle_number=vehicle_number,
            confidence=confidence,
            all_text=all_text
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR analysis failed: {str(e)}")

@api_router.post("/ocr/analyze-base64", response_model=OCRResult)
async def analyze_image_base64(data: dict):
    """Analyze base64 image for license plate using Google Vision API"""
    try:
        # Prepare request for Google Vision API
        request_data = {
            "requests": [
                {
                    "image": {
                        "content": data['image']
                    },
                    "features": [
                        {
                            "type": "TEXT_DETECTION",
                            "maxResults": 10
                        }
                    ]
                }
            ]
        }
        
        # Call Google Vision API
        response = requests.post(GOOGLE_VISION_URL, json=request_data)
        
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Google Vision API error: {response.text}")
        
        result = response.json()
        
        # Extract text annotations
        text_annotations = []
        all_text = []
        
        if 'responses' in result and result['responses']:
            annotations = result['responses'][0].get('textAnnotations', [])
            for annotation in annotations:
                text_annotations.append(annotation)
                all_text.append(annotation.get('description', ''))
        
        # Extract license plate
        vehicle_number, confidence = extract_license_plate_text(text_annotations)
        
        return OCRResult(
            vehicle_number=vehicle_number,
            confidence=confidence,
            all_text=all_text
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR analysis failed: {str(e)}")

@api_router.post("/parking/entry", response_model=ParkingRecord)
async def vehicle_entry(vehicle_number: str):
    """Record vehicle entry"""
    try:
        # Check if vehicle is already parked
        existing_record = await db.parking_records.find_one({
            "vehicle_number": vehicle_number,
            "status": "PARKED"
        })
        
        if existing_record:
            raise HTTPException(status_code=400, detail="Vehicle is already parked")
        
        # Create parking record
        parking_record = ParkingRecord(
            vehicle_number=vehicle_number,
            entry_time=datetime.utcnow(),
            status="PARKED"
        )
        
        await db.parking_records.insert_one(parking_record.dict())
        return parking_record
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to record entry: {str(e)}")

@api_router.post("/parking/exit")
async def vehicle_exit(vehicle_number: str):
    """Record vehicle exit and calculate fee"""
    try:
        # Find the parking record
        parking_record = await db.parking_records.find_one({
            "vehicle_number": vehicle_number,
            "status": "PARKED"
        })
        
        if not parking_record:
            raise HTTPException(status_code=404, detail="Vehicle not found or already exited")
        
        # Calculate duration and fee
        exit_time = datetime.utcnow()
        entry_time = parking_record['entry_time']
        duration_minutes, total_fee = calculate_parking_fee(entry_time, exit_time)
        
        # Update parking record
        await db.parking_records.update_one(
            {"id": parking_record["id"]},
            {
                "$set": {
                    "exit_time": exit_time,
                    "duration_minutes": duration_minutes,
                    "total_fee": total_fee,
                    "status": "EXITED"
                }
            }
        )
        
        # Return updated record
        updated_record = await db.parking_records.find_one({"id": parking_record["id"]})
        return {
            "vehicle_number": updated_record["vehicle_number"],
            "entry_time": updated_record["entry_time"],
            "exit_time": updated_record["exit_time"],
            "duration_minutes": updated_record["duration_minutes"],
            "total_fee": updated_record["total_fee"],
            "status": updated_record["status"]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to record exit: {str(e)}")

@api_router.get("/parking/records", response_model=List[dict])
async def get_parking_records():
    """Get all parking records"""
    try:
        records = await db.parking_records.find().sort("entry_time", -1).to_list(100)
        return records
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get records: {str(e)}")

@api_router.get("/parking/active", response_model=List[dict])
async def get_active_parking():
    """Get currently parked vehicles"""
    try:
        records = await db.parking_records.find({"status": "PARKED"}).sort("entry_time", -1).to_list(100)
        return records
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get active parking: {str(e)}")

@api_router.get("/parking/stats")
async def get_parking_stats():
    """Get parking statistics"""
    try:
        total_records = await db.parking_records.count_documents({})
        active_vehicles = await db.parking_records.count_documents({"status": "PARKED"})
        exited_vehicles = await db.parking_records.count_documents({"status": "EXITED"})
        
        # Calculate total revenue
        revenue_pipeline = [
            {"$match": {"status": "EXITED", "total_fee": {"$exists": True}}},
            {"$group": {"_id": None, "total_revenue": {"$sum": "$total_fee"}}}
        ]
        revenue_result = await db.parking_records.aggregate(revenue_pipeline).to_list(1)
        total_revenue = revenue_result[0]["total_revenue"] if revenue_result else 0
        
        return {
            "total_records": total_records,
            "active_vehicles": active_vehicles,
            "exited_vehicles": exited_vehicles,
            "total_revenue": total_revenue
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")

# Original endpoints for compatibility
@api_router.get("/")
async def root():
    return {"message": "Smart Parking System API"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()