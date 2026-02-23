export interface MotionVariant {
  initial: Record<string, number | string>;
  animate: Record<string, number | string>;
  transition: {
    duration?: number;
    ease?: [number, number, number, number] | string;
    type?: string;
    stiffness?: number;
    damping?: number;
    repeat?: number;
    repeatType?: 'loop' | 'reverse' | 'mirror';
  };
}

export const hoverLift: MotionVariant = {
  initial: { y: 0, scale: 1 },
  animate: { y: -7, scale: 1.025 },
  transition: { duration: 0.2, ease: [0.2, 0.7, 0.2, 1] },
};

export const placeBounce: MotionVariant = {
  initial: { y: -10, scale: 0.97, opacity: 0.5 },
  animate: { y: 0, scale: 1, opacity: 1 },
  transition: { type: 'spring', stiffness: 360, damping: 22 },
};

export const fadeIn: MotionVariant = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.26, ease: [0.2, 0.7, 0.2, 1] },
};

export const turnPulse: MotionVariant = {
  initial: { boxShadow: '0 0 0 rgba(131, 241, 202, 0)' },
  animate: { boxShadow: '0 0 0 8px rgba(131, 241, 202, 0)' },
  transition: { duration: 2.2, repeat: Infinity, repeatType: 'loop', ease: 'ease-out' },
};

export const tileSettle: MotionVariant = {
  initial: { y: -12, scale: 0.95, rotate: '-1deg' },
  animate: { y: 0, scale: 1, rotate: '0deg' },
  transition: { type: 'spring', stiffness: 430, damping: 24 },
};
