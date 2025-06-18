
import React from 'react';
import { ColorPickerProps } from '../types';

const ColorPicker: React.FC<ColorPickerProps> = ({ label, color, onChange }) => {
  return (
    <div className="mb-3 flex items-center justify-between">
      <label className="block text-sm font-medium text-gray-300">
        {label}
      </label>
      <div className="flex items-center space-x-2">
        <span className="text-sm text-gray-400 uppercase">{color}</span>
        <input
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 p-0 border-none rounded cursor-pointer bg-transparent"
          // The style below is a common workaround for color input styling issues.
          // However, strict adherence to "NO INLINE STYLES" means we rely on browser default or Tailwind for this.
          // For most modern browsers, direct class styling for type="color" is limited.
          // The className above provides basic sizing.
        />
      </div>
    </div>
  );
};

export default ColorPicker;