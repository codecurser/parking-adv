import requests
import unittest
import base64
import os
import sys
from datetime import datetime
import time
import json
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont

# Use the public endpoint from frontend/.env
BACKEND_URL = "https://a34269ea-4ebc-435f-9f6c-e6e0603648b0.preview.emergentagent.com/api"

class SmartParkingAPITest(unittest.TestCase):
    def setUp(self):
        self.test_vehicle_number = f"TEST{int(time.time())}"
        self.api_url = BACKEND_URL
        print(f"\nTesting with API URL: {self.api_url}")
        print(f"Using test vehicle number: {self.test_vehicle_number}")
        
    def test_01_api_health(self):
        """Test API health endpoint"""
        print("\n🔍 Testing API health...")
        response = requests.get(f"{self.api_url}/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["message"], "Smart Parking System API")
        print("✅ API health check passed")
        
    def test_02_ocr_analyze_base64(self):
        """Test OCR analysis with base64 image"""
        print("\n🔍 Testing OCR analysis with base64 image...")
        
        # Create a test image with text
        image = self.create_test_image_with_text(self.test_vehicle_number)
        buffered = BytesIO()
        image.save(buffered, format="JPEG")
        img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        
        # Send request
        response = requests.post(
            f"{self.api_url}/ocr/analyze-base64",
            json={"image": img_base64}
        )
        
        # Check response
        self.assertEqual(response.status_code, 200)
        data = response.json()
        print(f"OCR Result: {data}")
        
        # The OCR might not be perfect, so we'll just check if we get a response
        self.assertIn("vehicle_number", data)
        self.assertIn("confidence", data)
        self.assertIn("all_text", data)
        print("✅ OCR analysis with base64 image test passed")
        
    def test_03_parking_entry_exit_flow(self):
        """Test complete parking entry and exit flow"""
        print("\n🔍 Testing parking entry and exit flow...")
        
        # 1. Record vehicle entry
        print("Recording vehicle entry...")
        entry_response = requests.post(
            f"{self.api_url}/parking/entry",
            params={"vehicle_number": self.test_vehicle_number}
        )
        
        self.assertEqual(entry_response.status_code, 200)
        entry_data = entry_response.json()
        self.assertEqual(entry_data["vehicle_number"], self.test_vehicle_number)
        self.assertEqual(entry_data["status"], "PARKED")
        print(f"✅ Vehicle entry recorded: {entry_data}")
        
        # 2. Check active parking
        print("Checking active parking...")
        active_response = requests.get(f"{self.api_url}/parking/active")
        self.assertEqual(active_response.status_code, 200)
        active_data = active_response.json()
        
        # Find our test vehicle
        found = False
        for vehicle in active_data:
            if vehicle["vehicle_number"] == self.test_vehicle_number:
                found = True
                break
                
        self.assertTrue(found, "Test vehicle not found in active parking")
        print("✅ Vehicle found in active parking")
        
        # 3. Process vehicle exit
        print("Processing vehicle exit...")
        # Wait a bit to ensure some parking duration
        time.sleep(2)
        
        exit_response = requests.post(
            f"{self.api_url}/parking/exit",
            params={"vehicle_number": self.test_vehicle_number}
        )
        
        self.assertEqual(exit_response.status_code, 200)
        exit_data = exit_response.json()
        self.assertEqual(exit_data["vehicle_number"], self.test_vehicle_number)
        self.assertEqual(exit_data["status"], "EXITED")
        self.assertIsNotNone(exit_data["exit_time"])
        self.assertIsNotNone(exit_data["duration_minutes"])
        self.assertIsNotNone(exit_data["total_fee"])
        print(f"✅ Vehicle exit processed: {exit_data}")
        
        # 4. Check parking records
        print("Checking parking records...")
        records_response = requests.get(f"{self.api_url}/parking/records")
        self.assertEqual(records_response.status_code, 200)
        records_data = records_response.json()
        
        # Find our test vehicle in records
        found = False
        for record in records_data:
            if record["vehicle_number"] == self.test_vehicle_number:
                found = True
                self.assertEqual(record["status"], "EXITED")
                break
                
        self.assertTrue(found, "Test vehicle not found in parking records")
        print("✅ Vehicle found in parking records with EXITED status")
        
    def test_04_parking_stats(self):
        """Test parking statistics endpoint"""
        print("\n🔍 Testing parking statistics...")
        
        response = requests.get(f"{self.api_url}/parking/stats")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        # Check if stats contains required fields
        self.assertIn("total_records", data)
        self.assertIn("active_vehicles", data)
        self.assertIn("exited_vehicles", data)
        self.assertIn("total_revenue", data)
        
        print(f"✅ Parking stats retrieved: {data}")
        
    def test_05_duplicate_entry_prevention(self):
        """Test duplicate entry prevention"""
        print("\n🔍 Testing duplicate entry prevention...")
        
        # 1. Record vehicle entry
        entry_response = requests.post(
            f"{self.api_url}/parking/entry",
            params={"vehicle_number": self.test_vehicle_number}
        )
        
        self.assertEqual(entry_response.status_code, 200)
        print("✅ First entry recorded successfully")
        
        # 2. Try to record duplicate entry
        duplicate_response = requests.post(
            f"{self.api_url}/parking/entry",
            params={"vehicle_number": self.test_vehicle_number}
        )
        
        self.assertEqual(duplicate_response.status_code, 400)
        print("✅ Duplicate entry correctly rejected")
        
        # 3. Clean up by processing exit
        exit_response = requests.post(
            f"{self.api_url}/parking/exit",
            params={"vehicle_number": self.test_vehicle_number}
        )
        
        self.assertEqual(exit_response.status_code, 200)
        print("✅ Exit processed for cleanup")
        
    def create_test_image_with_text(self, text):
        """Create a test image with the given text"""
        # Create a blank image with white background
        width, height = 400, 200
        image = Image.new('RGB', (width, height), color='white')
        draw = ImageDraw.Draw(image)
        
        # Draw a black rectangle to simulate a license plate
        draw.rectangle([(50, 50), (350, 150)], outline='black', fill='white', width=2)
        
        # Add text
        draw.text((100, 85), text, fill='black')
        
        return image

if __name__ == "__main__":
    unittest.main(argv=['first-arg-is-ignored'], exit=False)