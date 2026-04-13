import { useState } from 'react';

interface Props {
  presetNames: string[];     // length 30
  connected: boolean;
  onRecall: (index: number) => void;
  onSave: (index: number, name: string) => void;
}

export default function PresetBar({ presetNames, connected, onRecall, onSave }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingName, setEditingName] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  function startEdit() {
    setEditingName(presetNames[selectedIndex] ?? `Preset ${selectedIndex + 1}`);
    setIsEditing(true);
  }

  function commitName() {
    const trimmed = editingName.trim() || `Preset ${selectedIndex + 1}`;
    onSave(selectedIndex, trimmed);
    setIsEditing(false);
  }

  return (
    <div className="panel">
      <div className="panel-header">Presets</div>
      <div className="flex flex-wrap items-center gap-2 p-2">

        {/* Preset selector */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
          <span className="text-xs text-gray-500 shrink-0">Preset</span>
          <select
            className="select flex-1"
            value={selectedIndex}
            onChange={e => {
              setSelectedIndex(Number(e.target.value));
              setIsEditing(false);
            }}
          >
            {presetNames.map((name, i) => (
              <option key={i} value={i}>
                {String(i + 1).padStart(2, '0')} — {name || `Preset ${i + 1}`}
              </option>
            ))}
          </select>
        </div>

        {/* Name editor */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
          {isEditing ? (
            <>
              <input
                className="input flex-1 text-sm"
                value={editingName}
                maxLength={20}
                autoFocus
                onChange={e => setEditingName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
                onBlur={commitName}
              />
              <button className="btn-ghost text-xs px-2" onClick={() => setIsEditing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn-ghost text-xs flex-1 text-left truncate"
              onClick={startEdit}
              disabled={!connected}
              title="Click to rename preset"
            >
              <span className="text-gray-400 mr-1">Name:</span>
              <span className="text-gray-200">
                {presetNames[selectedIndex] || `Preset ${selectedIndex + 1}`}
              </span>
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            className="btn-ghost text-sm"
            disabled={!connected}
            onClick={() => onRecall(selectedIndex)}
          >
            Recall
          </button>
          <button
            className="btn-primary text-sm"
            disabled={!connected}
            onClick={() => onSave(selectedIndex, presetNames[selectedIndex] || `Preset ${selectedIndex + 1}`)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
