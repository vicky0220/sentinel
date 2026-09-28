import React, { useState } from 'react';
import EChallanModal from './EChallanModal';

export default function SentinelOmnibar() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); 
  const [isOpen, setIsOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [isChallanModalOpen, setIsChallanModalOpen] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setIsOpen(true);
    setResult(null);
    setSelectedRecord(null);
    setIsChallanModalOpen(false);

    try {
      const res = await fetch('http://localhost:5000/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: query })
      });
      const data = await res.json();
      setResult(data);
    } catch (error) {
      setResult({ reply: "SYSTEM ERROR: API Core Offline.", records: [] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute top-6 left-1/2 -translate-x-1/2 w-full max-w-5xl z-[3000] flex flex-col items-center">
      
      {/* 1. THE SEARCH BAR */}
      <form onSubmit={handleSearch} className="w-full bg-slate-950/95 backdrop-blur-xl border border-slate-700/80 rounded-full shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] flex items-center px-4 py-2 transition-all focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
        <span className="text-blue-500 mr-3 animate-pulse text-lg">●</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Command Sentinel OS (e.g., 'Find stolen vehicles' or 'Check plate GJ01AB1234')"
          className="flex-1 bg-transparent border-none text-slate-200 text-sm font-mono placeholder-slate-600 focus:outline-none"
        />
        <button type="submit" disabled={loading} className="ml-3 bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 border border-blue-500/30 px-6 py-2 rounded-full text-xs font-black font-mono transition disabled:opacity-50 uppercase tracking-widest">
          {loading ? 'Routing...' : 'Execute'}
        </button>
      </form>

      {/* 2. THE DROPDOWN RESULT PANEL */}
      {isOpen && (
        <div className="w-full mt-3 bg-[#0b1120]/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl p-5 select-auto flex flex-col min-h-[300px] animate-in slide-in-from-top-2">
          
          {/* Header */}
          <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
              Vertex AI Data Retrieval
            </span>
            <button onClick={() => { setIsOpen(false); setSelectedRecord(null); setIsChallanModalOpen(false); }} className="text-slate-400 hover:text-white text-xs font-bold bg-slate-800/50 hover:bg-slate-700 px-3 py-1 rounded transition border border-slate-700">
              ✕ CLOSE
            </button>
          </div>

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 font-mono text-sm gap-4 py-10">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="animate-pulse">Synthesizing telemetry across 5 databases...</p>
            </div>
          ) : (
            <div className="flex-1 relative overflow-hidden">
              
              {/* VIEW A: COMPACT CARD GRID */}
              {!selectedRecord && (
                <div className="animate-in fade-in duration-300">
                  
                  {/* Suppress LLM text if records exist. Only show text if NO records are found. */}
                  {(!result?.records || result.records.length === 0) ? (
                    <div className="font-mono text-sm text-slate-300 whitespace-pre-wrap leading-relaxed p-6 bg-slate-900/50 rounded-xl border border-slate-800 border-dashed text-center">
                      {result?.reply || "No database records found matching this query."}
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-4 max-h-[450px] overflow-y-auto custom-scrollbar pr-2 pb-2">
                      {result.records.map((record, idx) => {
                        const isGhostPlate = record.ghost_plate_anomaly;
                        const isAlert = record.alert_triggered || record.watchlist_status;
                        
                        return (
                          <div 
                            key={idx} 
                            onClick={() => setSelectedRecord(record)}
                            className={`rounded-xl overflow-hidden cursor-pointer transition-all group flex flex-col shadow-lg border ${
                              isGhostPlate ? 'bg-red-950/20 border-red-500/50 hover:shadow-[0_0_20px_rgba(239,68,68,0.3)]' 
                              : isAlert ? 'bg-amber-950/20 border-amber-500/50 hover:shadow-[0_0_20px_rgba(245,158,11,0.3)]'
                              : 'bg-slate-900 border-slate-700 hover:border-blue-500'
                            }`}
                          >
                            {/* Card Image */}
                            <div className="h-32 w-full bg-black relative border-b border-slate-800">
                              {record.image_data ? (
                                <img src={record.image_data} alt={record.plate_number} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-3xl opacity-50">🚗</div>
                              )}
                              
                              {/* Overlay Badges */}
                              <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                                {isGhostPlate && (
                                  <span className="bg-red-600 text-white px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider shadow-md animate-pulse">
                                    🚨 GHOST PLATE
                                  </span>
                                )}
                                {isAlert && !isGhostPlate && (
                                  <span className="bg-amber-500 text-amber-950 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider shadow-md">
                                    ⚠️ WATCHLIST
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Card Body */}
                            <div className="p-3 flex-1 flex flex-col">
                              <span className={`font-mono font-black text-lg tracking-wider mb-1 ${isGhostPlate ? 'text-red-400' : isAlert ? 'text-amber-400' : 'text-slate-100'}`}>
                                {record.plate_number}
                              </span>
                              <p className="text-[10px] text-slate-400 font-bold uppercase mb-3 flex-1">
                                {record.color} {record.entity_type}
                              </p>
                              
                              <div className="flex justify-between items-center text-[9px] font-mono text-slate-500 border-t border-slate-800 pt-2">
                                <span className="truncate max-w-[60%] text-slate-400">{record.camera_id?.toUpperCase()}</span>
                                <span>{record.timestamp_utc?.split('T')[1]?.split('.')[0] || 'Recent'}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* VIEW B: EXPANDED ENTERPRISE DOSSIER */}
              {selectedRecord && (
                <div className="animate-in slide-in-from-right-4 duration-300 h-full flex flex-col">
                  
                  {/* Top Control Bar */}
                  <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-4">
                      <button onClick={() => setSelectedRecord(null)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-bold transition border border-slate-700">← Return to Grid</button>
                      <h2 className="text-xl font-mono font-black tracking-widest text-white flex items-center gap-3">
                        {selectedRecord.plate_number}
                        {selectedRecord.ghost_plate_anomaly && (
                          <span className="px-2 py-0.5 bg-red-600/20 border border-red-500 text-red-400 text-[10px] uppercase rounded animate-pulse">Cloned Registration Mismatch</span>
                        )}
                        {(selectedRecord.alert_triggered || selectedRecord.watchlist_status) && !selectedRecord.ghost_plate_anomaly && (
                          <span className="px-2 py-0.5 bg-amber-500/20 border border-amber-500 text-amber-400 text-[10px] uppercase rounded">Watchlist Target</span>
                        )}
                      </h2>
                    </div>
                  </div>

                  {/* 3-Column Dossier Layout */}
                  <div className="grid grid-cols-3 gap-5">
                    
                    {/* COLUMN 1: Visual Telemetry */}
                    <div className={`col-span-1 rounded-xl border flex flex-col overflow-hidden shadow-lg ${selectedRecord.ghost_plate_anomaly ? 'bg-red-950/10 border-red-500/30' : 'bg-slate-900/50 border-slate-700'}`}>
                      <div className="bg-slate-950/80 p-2 text-center border-b border-slate-800">
                        <span className="text-[10px] font-black uppercase text-blue-400 tracking-widest">YOLOv8 Edge Telemetry</span>
                      </div>
                      <div className="h-48 w-full bg-black relative">
                        {selectedRecord.image_data ? (
                          <img src={selectedRecord.image_data} className="w-full h-full object-cover" alt="Vehicle Crop" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-700">NO IMAGE BUFFER</div>
                        )}
                      </div>
                      <div className="p-4 space-y-3 flex-1">
                        <div>
                          <p className="text-[9px] text-slate-500 font-mono uppercase mb-0.5">Detected Class</p>
                          <p className="text-sm font-bold text-white uppercase">{selectedRecord.color} {selectedRecord.entity_type}</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-slate-500 font-mono uppercase mb-0.5">Last Known Node</p>
                          <p className="text-xs font-mono text-slate-300">{selectedRecord.camera_id?.toUpperCase()} • {selectedRecord.location}</p>
                        </div>
                        <div>
                          <p className="text-[9px] text-slate-500 font-mono uppercase mb-0.5">Timestamp</p>
                          <p className="text-xs font-mono text-slate-300">{selectedRecord.timestamp_utc ? new Date(selectedRecord.timestamp_utc).toLocaleString() : 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {/* COLUMN 2: VAHAN & FASTag */}
                    <div className="col-span-1 flex flex-col gap-5">
                      {/* VAHAN Registry */}
                      <div className={`rounded-xl border flex-1 p-4 shadow-sm ${selectedRecord.ghost_plate_anomaly ? 'bg-red-950/20 border-red-500/50' : 'bg-slate-900/50 border-slate-700'}`}>
                        <h4 className={`text-[10px] uppercase font-black tracking-widest mb-3 border-b pb-2 ${selectedRecord.ghost_plate_anomaly ? 'text-red-400 border-red-500/30' : 'text-emerald-400 border-slate-700'}`}>
                          NIC Parivahan Registry
                        </h4>
                        {selectedRecord.rto_dossier ? (
                          <div className="space-y-3">
                            <div>
                              <p className="text-[9px] text-slate-500 font-mono uppercase">Registered Class</p>
                              <p className={`text-sm font-bold uppercase ${selectedRecord.ghost_plate_anomaly ? 'text-red-400 line-through decoration-2' : 'text-white'}`}>
                                {selectedRecord.rto_dossier.vehicle_class} • {selectedRecord.rto_dossier.model_name}
                              </p>
                            </div>
                            <div>
                              <p className="text-[9px] text-slate-500 font-mono uppercase">Registered Owner</p>
                              <p className="text-xs font-bold text-slate-200 uppercase">{selectedRecord.rto_dossier.owner_name}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                              <div>
                                <p className="text-[9px] text-slate-500 font-mono uppercase">Insurance</p>
                                <p className={`text-xs font-black ${selectedRecord.rto_dossier.insurance_status === 'VALID' ? 'text-emerald-400' : 'text-rose-500'}`}>{selectedRecord.rto_dossier.insurance_status}</p>
                              </div>
                              <div>
                                <p className="text-[9px] text-slate-500 font-mono uppercase">PUCC</p>
                                <p className={`text-xs font-black ${selectedRecord.rto_dossier.pucc_status === 'VALID' ? 'text-emerald-400' : 'text-amber-500'}`}>{selectedRecord.rto_dossier.pucc_status}</p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500 italic">No registration found.</p>
                        )}
                      </div>

                      {/* FASTag Data */}
                      <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 shadow-sm">
                        <h4 className="text-[10px] uppercase font-black tracking-widest mb-2 border-b border-slate-700 pb-2 text-blue-400">
                          NETC FASTag Status
                        </h4>
                        {selectedRecord.fastag_status ? (
                          <p className="text-xs font-mono text-slate-300 bg-slate-950 p-2 rounded border border-slate-800">{selectedRecord.fastag_status}</p>
                        ) : (
                          <p className="text-xs text-slate-500 italic">No recent toll pings.</p>
                        )}
                      </div>
                    </div>

                    {/* COLUMN 3: Security & Enforcement */}
                    <div className="col-span-1 flex flex-col gap-5">
                      
                      {/* Security Alerts (eGujCop) */}
                      <div className={`rounded-xl border flex-1 p-4 shadow-sm ${selectedRecord.watchlist_status || selectedRecord.alert_triggered ? 'bg-amber-950/20 border-amber-500/50' : 'bg-slate-900/50 border-slate-700'}`}>
                        <h4 className="text-[10px] uppercase font-black tracking-widest mb-3 border-b border-slate-700 pb-2 text-amber-500">
                          Security & Warrants
                        </h4>
                        {(selectedRecord.watchlist_status || selectedRecord.alert_reason) ? (
                          <div className="bg-amber-950/50 border border-amber-500/30 p-3 rounded-lg">
                            <p className="text-[10px] text-amber-500 font-bold uppercase mb-1">Active eGujCop Advisory</p>
                            <p className="text-xs font-mono text-amber-200">{selectedRecord.watchlist_status || selectedRecord.alert_reason}</p>
                            <button className="w-full mt-4 bg-amber-600 hover:bg-amber-500 text-amber-950 text-[10px] font-black uppercase py-2 rounded transition shadow-md">
                              Update Warrant Status
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-24 text-emerald-500/50 text-xs font-mono border border-dashed border-emerald-500/20 rounded-lg">
                            NO ACTIVE WARRANTS
                          </div>
                        )}
                      </div>

                      {/* e-Challan Generation */}
                      <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 shadow-sm">
                        <h4 className="text-[10px] uppercase font-black tracking-widest mb-2 border-b border-slate-700 pb-2 text-slate-300">
                          e-Challan Enforcement
                        </h4>
                        {selectedRecord.rto_dossier?.total_fine_amount > 0 ? (
                          <div>
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-[10px] font-bold text-rose-400 uppercase">Pending Fines</span>
                              <span className="text-base font-black text-rose-500">₹{selectedRecord.rto_dossier.total_fine_amount.toLocaleString()}</span>
                            </div>
                            <button 
                              onClick={() => setIsChallanModalOpen(true)}
                              className="w-full mt-2 bg-rose-600/20 hover:bg-rose-600 border border-rose-500 text-rose-400 hover:text-white text-[9px] font-black uppercase py-2 rounded transition tracking-widest"
                            >
                              Generate Notice
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500 text-center py-2">No pending violations.</p>
                        )}
                      </div>

                    </div>
                  </div>

                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Render the E-Challan Modal on top of everything if it's open */}
      <EChallanModal 
        isOpen={isChallanModalOpen} 
        onClose={() => setIsChallanModalOpen(false)} 
        record={selectedRecord} 
      />

    </div>
  );
}