import React from 'react';

export default function EChallanModal({ isOpen, onClose, record }) {
  if (!isOpen || !record) return null;

  // 1. Parse the Reason String from Python 
  // Example: "WRONG-WAY DRIVING (Sec 184 MVA) + NO HELMET (Sec 129 MVA) | Total Fine: ₹2000"
  const reasonStr = record.reason || 'Traffic Violation Detected';
  let offenses = [];
  let totalFine = 1000; // Default fallback

  if (reasonStr.includes('|')) {
    const parts = reasonStr.split('|');
    offenses = parts[0].split('+').map(o => o.trim());
    totalFine = parts[1].replace(/\D/g, ''); // Extract just the numbers for the total
  } else {
    offenses = [reasonStr];
    if (reasonStr.includes('WRONG-WAY')) totalFine = 1500;
    if (reasonStr.includes('HELMET') && !reasonStr.includes('WRONG-WAY')) totalFine = 1000;
  }

  // Helper to assign correct line-item prices for realism
  const getLineItemFine = (offenseText) => {
    if (offenseText.includes('184') || offenseText.includes('WRONG-WAY')) return 1500;
    if (offenseText.includes('129') || offenseText.includes('HELMET')) {
      // Helmet fine is 500 if compounded with wrong-way, otherwise 1000
      return offenses.length > 1 ? 500 : 1000;
    }
    return totalFine;
  };

  return (
    <div className="fixed inset-0 z-[6000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex border-b border-slate-200 p-6 items-center justify-between bg-white">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full border-2 border-slate-800 flex items-center justify-center font-black text-xl text-slate-800">
              GJ
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-widest uppercase">Gujarat Traffic Police</h2>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">E-Detection Gujarat / Enforcement Branch</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Challan No.</p>
            <p className="text-sm font-mono font-black text-slate-800 uppercase">
              GJ{Math.floor(Math.random() * 90000) + 10000}{Date.now().toString().slice(-6)}
            </p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 mb-0.5">Date / Time</p>
            <p className="text-xs font-mono font-bold text-slate-700">
              {record.timestamp_utc ? new Date(record.timestamp_utc).toLocaleString() : new Date().toLocaleString()}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 bg-slate-50 flex flex-col gap-6">
          
          <div className="grid grid-cols-2 gap-6">
            {/* Left Col: Profile */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-col">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest border-b border-slate-100 pb-3 mb-4">
                Vehicle & Owner Profile
              </h3>
              <div className="space-y-4 flex-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Owner:</span>
                  <span className="text-sm font-bold text-slate-800">UNKNOWN</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Plate No:</span>
                  <span className="text-sm font-mono font-black text-slate-800">{record.plate_number || 'UNREADABLE'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Class:</span>
                  <span className="text-sm font-bold text-slate-800">{record.entity_type || 'Vehicle'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Location:</span>
                  <span className="text-sm font-mono font-bold text-slate-800">{record.camera_id?.toUpperCase() || 'STATEWIDE MESH'}</span>
                </div>
              </div>
            </div>

            {/* Right Col: Image Evidence (Fixed to Object-Contain) */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm flex flex-col">
              <div className="bg-slate-800 text-white text-[10px] font-black py-2 px-4 uppercase tracking-widest text-center">
                ANPR Visual Capture
              </div>
              <div className="relative h-48 bg-slate-100 flex items-center justify-center p-2">
                {record.image_data ? (
                  // FIXED: object-contain ensures the image is scaled to fit inside the box perfectly without cutting off the head
                  <img 
                    src={record.image_data} 
                    alt="Evidence" 
                    className="max-w-full max-h-full object-contain rounded drop-shadow-md" 
                  />
                ) : (
                  <span className="text-slate-400 font-mono text-xs">NO VISUAL EVIDENCE</span>
                )}
              </div>
            </div>
          </div>

          {/* Itemized Violations Table */}
          <div>
            <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-3">
              Itemized Violations
            </h3>
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200">
                    <th className="py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-widest w-16">SL</th>
                    <th className="py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Offense Description</th>
                    <th className="py-3 px-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Fine (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {offenses.map((offense, index) => (
                    <tr key={index} className="border-b border-slate-100 last:border-0">
                      <td className="py-4 px-4 font-mono font-bold text-slate-400">{index + 1}</td>
                      <td className="py-4 px-4 font-bold text-slate-800 uppercase text-xs">{offense}</td>
                      <td className="py-4 px-4 text-right font-mono font-black text-slate-800">
                        ₹{getLineItemFine(offense)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total Penalty Footer */}
            <div className="mt-4 bg-slate-100 border border-slate-200 rounded-lg py-4 px-6 flex justify-between items-center shadow-sm">
              <span className="text-sm font-black text-slate-800 uppercase tracking-widest">Total Penalty:</span>
              <span className="text-2xl font-black text-rose-600">₹{totalFine}</span>
            </div>
          </div>
          
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-200 bg-white p-5 flex justify-between items-center">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-lg transition-colors"
          >
            Close Window
          </button>
          <button 
            onClick={() => {
              alert("Notice dispatched via SMS/Email to registered owner.");
              onClose();
            }}
            className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-lg shadow-lg transition-colors"
          >
            Dispatch e-Memo Notice
          </button>
        </div>

      </div>
    </div>
  );
}