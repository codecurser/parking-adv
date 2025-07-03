import React, { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CameraComponent = ({ title, mode, onProcessVehicle, disabled }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastCapture, setLastCapture] = useState(null);

  // Start camera stream
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'environment'
        }
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
        setError(null);
      }
    } catch (err) {
      setError('Failed to access camera: ' + err.message);
    }
  }, []);

  // Stop camera stream
  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsStreaming(false);
    }
  }, []);

  // Capture and process vehicle
  const captureAndProcess = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || loading || disabled) return;

    setLoading(true);
    setError(null);

    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const context = canvas.getContext('2d');

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = canvas.toDataURL('image/jpeg', 0.8);
      const base64Data = imageData.split(',')[1];

      // Store the captured image for display
      setLastCapture(imageData);

      // Process OCR
      const response = await axios.post(`${API}/ocr/analyze-base64`, {
        image: base64Data
      });

      if (response.data.vehicle_number) {
        await onProcessVehicle(response.data.vehicle_number, mode);
      } else {
        setError('No license plate detected. Please try again.');
      }

    } catch (err) {
      setError('Processing failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [loading, disabled, onProcessVehicle, mode]);

  // Auto-capture every 5 seconds when streaming
  useEffect(() => {
    if (isStreaming && !loading && !disabled) {
      const interval = setInterval(() => {
        captureAndProcess();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isStreaming, loading, disabled, captureAndProcess]);

  return (
    <div className={`camera-section ${mode}`}>
      <div className="camera-header">
        <h3>{title}</h3>
        <div className="camera-status">
          {isStreaming ? (
            <span className="status-active">🟢 Active</span>
          ) : (
            <span className="status-inactive">🔴 Inactive</span>
          )}
        </div>
      </div>

      <div className="camera-controls">
        {!isStreaming ? (
          <button onClick={startCamera} className="btn-primary">
            📷 Start {title}
          </button>
        ) : (
          <div className="camera-actions">
            <button onClick={captureAndProcess} disabled={loading || disabled} className="btn-primary">
              {loading ? '🔄 Processing...' : '📸 Capture Now'}
            </button>
            <button onClick={stopCamera} className="btn-secondary">
              ⏹️ Stop Camera
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      <div className="camera-feed">
        {isStreaming && (
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="video-stream"
          />
        )}
        {lastCapture && (
          <div className="last-capture">
            <h4>Last Capture:</h4>
            <img src={lastCapture} alt="Last capture" className="capture-preview" />
          </div>
        )}
        <canvas 
          ref={canvasRef} 
          style={{ display: 'none' }}
        />
      </div>

      {loading && (
        <div className="processing-indicator">
          <div className="loading-spinner"></div>
          <p>Processing vehicle...</p>
        </div>
      )}
    </div>
  );
};

const SmartParkingSystem = () => {
  const [parkingRecords, setParkingRecords] = useState([]);
  const [activeVehicles, setActiveVehicles] = useState([]);
  const [stats, setStats] = useState({});
  const [currentTab, setCurrentTab] = useState('cameras');
  const [systemStatus, setSystemStatus] = useState('active');
  const [recentActivity, setRecentActivity] = useState([]);

  // Fetch parking data
  const fetchParkingData = useCallback(async () => {
    try {
      const [recordsRes, activeRes, statsRes] = await Promise.all([
        axios.get(`${API}/parking/records`),
        axios.get(`${API}/parking/active`),
        axios.get(`${API}/parking/stats`)
      ]);
      
      setParkingRecords(recordsRes.data);
      setActiveVehicles(activeRes.data);
      setStats(statsRes.data);
    } catch (err) {
      console.error('Failed to fetch parking data:', err);
    }
  }, []);

  useEffect(() => {
    fetchParkingData();
    // Refresh data every 10 seconds
    const interval = setInterval(fetchParkingData, 10000);
    return () => clearInterval(interval);
  }, [fetchParkingData]);

  // Process vehicle entry
  const processVehicleEntry = useCallback(async (vehicleNumber) => {
    try {
      const response = await axios.post(`${API}/parking/entry?vehicle_number=${vehicleNumber}`);
      
      // Add to recent activity
      setRecentActivity(prev => [
        { 
          type: 'entry', 
          vehicle: vehicleNumber, 
          time: new Date().toLocaleTimeString(),
          message: `Vehicle ${vehicleNumber} entered parking`
        },
        ...prev.slice(0, 4)
      ]);

      fetchParkingData();
      return true;
    } catch (err) {
      console.error('Entry failed:', err);
      setRecentActivity(prev => [
        { 
          type: 'error', 
          vehicle: vehicleNumber, 
          time: new Date().toLocaleTimeString(),
          message: `Entry failed: ${err.response?.data?.detail || 'Unknown error'}`
        },
        ...prev.slice(0, 4)
      ]);
      return false;
    }
  }, [fetchParkingData]);

  // Process vehicle exit
  const processVehicleExit = useCallback(async (vehicleNumber) => {
    try {
      const response = await axios.post(`${API}/parking/exit?vehicle_number=${vehicleNumber}`);
      
      const exitData = response.data;
      
      // Add to recent activity
      setRecentActivity(prev => [
        { 
          type: 'exit', 
          vehicle: vehicleNumber, 
          time: new Date().toLocaleTimeString(),
          message: `Vehicle ${vehicleNumber} exited - Fee: ₹${exitData.total_fee?.toFixed(2) || 0}`
        },
        ...prev.slice(0, 4)
      ]);

      fetchParkingData();
      return true;
    } catch (err) {
      console.error('Exit failed:', err);
      setRecentActivity(prev => [
        { 
          type: 'error', 
          vehicle: vehicleNumber, 
          time: new Date().toLocaleTimeString(),
          message: `Exit failed: ${err.response?.data?.detail || 'Unknown error'}`
        },
        ...prev.slice(0, 4)
      ]);
      return false;
    }
  }, [fetchParkingData]);

  // Handle vehicle processing from cameras
  const handleVehicleProcess = useCallback(async (vehicleNumber, mode) => {
    if (mode === 'entry') {
      return await processVehicleEntry(vehicleNumber);
    } else {
      return await processVehicleExit(vehicleNumber);
    }
  }, [processVehicleEntry, processVehicleExit]);

  const formatDateTime = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDuration = (minutes) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="smart-parking-system">
      <header className="header">
        <h1>🚗 Smart Parking System</h1>
        <div className="system-status">
          <span className={`status-indicator ${systemStatus}`}>
            {systemStatus === 'active' ? '🟢 System Active' : '🔴 System Inactive'}
          </span>
        </div>
        <div className="stats-bar">
          <div className="stat">
            <span className="stat-label">Active Vehicles</span>
            <span className="stat-value">{stats.active_vehicles || 0}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Total Revenue</span>
            <span className="stat-value">₹{(stats.total_revenue || 0).toFixed(2)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Total Records</span>
            <span className="stat-value">{stats.total_records || 0}</span>
          </div>
        </div>
      </header>

      <nav className="tabs">
        <button 
          className={currentTab === 'cameras' ? 'active' : ''}
          onClick={() => setCurrentTab('cameras')}
        >
          📷 Live Cameras
        </button>
        <button 
          className={currentTab === 'active' ? 'active' : ''}
          onClick={() => setCurrentTab('active')}
        >
          🚗 Active Parking
        </button>
        <button 
          className={currentTab === 'records' ? 'active' : ''}
          onClick={() => setCurrentTab('records')}
        >
          📊 All Records
        </button>
      </nav>

      {currentTab === 'cameras' && (
        <div className="cameras-section">
          <div className="cameras-grid">
            <CameraComponent
              title="Entry Camera"
              mode="entry"
              onProcessVehicle={handleVehicleProcess}
              disabled={systemStatus !== 'active'}
            />
            <CameraComponent
              title="Exit Camera"
              mode="exit"
              onProcessVehicle={handleVehicleProcess}
              disabled={systemStatus !== 'active'}
            />
          </div>
          
          <div className="recent-activity">
            <h3>🔔 Recent Activity</h3>
            {recentActivity.length === 0 ? (
              <p className="no-activity">No recent activity</p>
            ) : (
              <div className="activity-list">
                {recentActivity.map((activity, index) => (
                  <div key={index} className={`activity-item ${activity.type}`}>
                    <div className="activity-time">{activity.time}</div>
                    <div className="activity-message">{activity.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {currentTab === 'active' && (
        <div className="active-parking-section">
          <h2>🚗 Currently Parked Vehicles</h2>
          {activeVehicles.length === 0 ? (
            <p className="empty-state">No vehicles currently parked</p>
          ) : (
            <div className="vehicles-grid">
              {activeVehicles.map((vehicle, index) => (
                <div key={index} className="vehicle-card active">
                  <div className="vehicle-number">{vehicle.vehicle_number}</div>
                  <div className="vehicle-details">
                    <p><strong>Entry:</strong> {formatDateTime(vehicle.entry_time)}</p>
                    <p><strong>Duration:</strong> {formatDuration(Math.floor((new Date() - new Date(vehicle.entry_time)) / 60000))}</p>
                    <p><strong>Status:</strong> <span className="status-parked">PARKED</span></p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {currentTab === 'records' && (
        <div className="records-section">
          <h2>📊 All Parking Records</h2>
          {parkingRecords.length === 0 ? (
            <p className="empty-state">No parking records found</p>
          ) : (
            <div className="records-table">
              <table>
                <thead>
                  <tr>
                    <th>Vehicle Number</th>
                    <th>Entry Time</th>
                    <th>Exit Time</th>
                    <th>Duration</th>
                    <th>Fee</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parkingRecords.map((record, index) => (
                    <tr key={index}>
                      <td className="vehicle-number">{record.vehicle_number}</td>
                      <td>{formatDateTime(record.entry_time)}</td>
                      <td>{record.exit_time ? formatDateTime(record.exit_time) : '-'}</td>
                      <td>{record.duration_minutes ? formatDuration(record.duration_minutes) : '-'}</td>
                      <td>{record.total_fee ? `₹${record.total_fee.toFixed(2)}` : '-'}</td>
                      <td>
                        <span className={`status-${record.status.toLowerCase()}`}>
                          {record.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <SmartParkingSystem />
    </div>
  );
}

export default App;