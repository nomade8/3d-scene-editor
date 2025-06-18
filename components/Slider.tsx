
import React from 'react';
import { SliderProps } from '../types';

const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, onChange, unit = '' }) => {
  return (
    <div className="mb-3">
      <label className="block text-sm font-medium text-gray-300 mb-1">
        {label}: <span className="font-semibold text-blue-400">{value.toFixed(2)}{unit}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
    </div>
  );
};

export default Slider;