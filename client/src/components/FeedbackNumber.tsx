import { useState } from 'react';
import './feedbackNumber.css';

/** Exact strategic readout; acknowledge change without interpolating false counts. */
export function FeedbackNumber({ value, className = '' }: { value: number; className?: string }) {
  const [observed, setObserved] = useState({ value, changed: false });
  if (observed.value !== value) setObserved({ value, changed: true });
  return (
    <span className={className}>
      <span key={value} className={observed.changed ? 'rh-number-change' : undefined}>{value}</span>
    </span>
  );
}
