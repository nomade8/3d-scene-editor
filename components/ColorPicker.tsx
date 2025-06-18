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
        />
      </div>
    </div>
  );
};

export default ColorPicker;