import React, { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SmartParkingSystem = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [ocrResult, setOcrResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [parkingRecords, setParkingRecords] = useState([]);
  const [activeVehicles, setActiveVehicles] = useState([]);
  const [stats, setStats] = useState({});
  const [mode, setMode] = useState('entry'); // 'entry' or 'exit'
  const [currentTab, setCurrentTab] = useState('scanner'); // 'scanner', 'records', 'active'

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
  }, [fetchParkingData]);

  // Start camera stream
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 },
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

  // Capture and analyze image
  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

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

      const response = await axios.post(`${API}/ocr/analyze-base64`, {
        image: base64Data
      });

      setOcrResult(response.data);
    } catch (err) {
      setError('OCR analysis failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Process vehicle entry
  const processVehicleEntry = useCallback(async (vehicleNumber) => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(`${API}/parking/entry?vehicle_number=${vehicleNumber}`);
      setOcrResult(null);
      fetchParkingData();
      alert(`Vehicle ${vehicleNumber} entry recorded successfully!`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to record entry');
    } finally {
      setLoading(false);
    }
  }, [fetchParkingData]);

  // Process vehicle exit
  const processVehicleExit = useCallback(async (vehicleNumber) => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(`${API}/parking/exit?vehicle_number=${vehicleNumber}`);
      setOcrResult(null);
      fetchParkingData();
      
      const exitData = response.data;
      alert(`Vehicle ${vehicleNumber} exit processed!
Entry: ${new Date(exitData.entry_time).toLocaleString()}
Exit: ${new Date(exitData.exit_time).toLocaleString()}
Duration: ${exitData.duration_minutes} minutes
Total Fee: ₹${exitData.total_fee.toFixed(2)}`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to record exit');
    } finally {
      setLoading(false);
    }
  }, [fetchParkingData]);

  // File upload handler
  const handleFileUpload = useCallback(async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await axios.post(`${API}/ocr/analyze`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setOcrResult(response.data);
    } catch (err) {
      setError('File upload failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

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
          className={currentTab === 'scanner' ? 'active' : ''}
          onClick={() => setCurrentTab('scanner')}
        >
          📷 Scanner
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

      {currentTab === 'scanner' && (
        <div className="scanner-section">
          <div className="mode-selector">
            <button 
              className={mode === 'entry' ? 'active' : ''}
              onClick={() => setMode('entry')}
            >
              🚪 Entry
            </button>
            <button 
              className={mode === 'exit' ? 'active' : ''}
              onClick={() => setMode('exit')}
            >
              🚪 Exit
            </button>
          </div>

          <div className="camera-controls">
            {!isStreaming ? (
              <button onClick={startCamera} className="btn-primary">
                📷 Start Camera
              </button>
            ) : (
              <div className="camera-actions">
                <button onClick={captureAndAnalyze} disabled={loading} className="btn-primary">
                  {loading ? '🔄 Analyzing...' : '📸 Capture & Analyze'}
                </button>
                <button onClick={stopCamera} className="btn-secondary">
                  ⏹️ Stop Camera
                </button>
              </div>
            )}
          </div>

          <div className="file-upload">
            <input 
              type="file" 
              accept="image/*" 
              onChange={handleFileUpload}
              disabled={loading}
              className="file-input"
            />
            <label>Or upload an image file</label>
          </div>

          {isStreaming && (
            <div className="video-container">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="video-stream"
              />
              <canvas 
                ref={canvasRef} 
                style={{ display: 'none' }}
              />
            </div>
          )}

          {error && (
            <div className="error-message">
              ⚠️ {error}
            </div>
          )}

          {ocrResult && (
            <div className="ocr-results">
              <h3>🔍 OCR Results</h3>
              
              {ocrResult.vehicle_number ? (
                <div className="license-plate-result">
                  <h4>Detected License Plate:</h4>
                  <div className="license-plate">
                    <span className="plate-number">{ocrResult.vehicle_number}</span>
                    <span className="confidence">Confidence: {(ocrResult.confidence * 100).toFixed(1)}%</span>
                  </div>
                  
                  <div className="action-buttons">
                    {mode === 'entry' ? (
                      <button 
                        onClick={() => processVehicleEntry(ocrResult.vehicle_number)}
                        disabled={loading}
                        className="btn-success"
                      >
                        ✅ Record Entry
                      </button>
                    ) : (
                      <button 
                        onClick={() => processVehicleExit(ocrResult.vehicle_number)}
                        disabled={loading}
                        className="btn-danger"
                      >
                        🚪 Process Exit
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="no-plate-detected">
                  <p>❌ No license plate detected</p>
                  <details>
                    <summary>All Detected Text ({ocrResult.all_text.length} items)</summary>
                    <ul>
                      {ocrResult.all_text.map((text, index) => (
                        <li key={index}>{text}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
            </div>
          )}
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