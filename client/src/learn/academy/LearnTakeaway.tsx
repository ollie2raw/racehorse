type LearnTakeawayProps = {
  children: React.ReactNode;
  variant?: 'default' | 'gold';
};

export function LearnTakeaway({ children, variant = 'default' }: LearnTakeawayProps) {
  return (
    <div className={`learn-academy__takeaway learn-academy__takeaway--${variant}`}>
      <span className="learn-academy__takeaway-kicker">Takeaway</span>
      <p className="learn-academy__takeaway-body">{children}</p>
    </div>
  );
}
