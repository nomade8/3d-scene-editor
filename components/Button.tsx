
import React from 'react';
import { ButtonProps } from '../types';

const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', size = 'md', className = '', ...props }) => {
  const baseStyle = "font-medium rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 transition-colors duration-150 flex items-center justify-center";
  
  let variantStyle = "";
  switch (variant) {
    case 'primary':
      variantStyle = "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500 text-white";
      break;
    case 'secondary':
      variantStyle = "bg-gray-600 hover:bg-gray-700 focus:ring-gray-500 text-gray-100";
      break;
    case 'danger':
      variantStyle = "bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white";
      break;
  }

  let sizeStyle = "";
  switch (size) {
    case 'sm':
      sizeStyle = "px-3 py-1.5 text-sm";
      break;
    case 'md':
      sizeStyle = "px-4 py-2 text-base";
      break;
    case 'lg':
      sizeStyle = "px-6 py-3 text-lg";
      break;
  }

  return (
    <button
      className={`${baseStyle} ${variantStyle} ${sizeStyle} ${className} disabled:opacity-50 disabled:cursor-not-allowed`}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;