import React from 'react';
import { useApp } from '../context/AppContext';

export const Toast: React.FC = () => {
  const { toastMsg } = useApp();

  if (!toastMsg) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      {toastMsg}
    </div>
  );
};
