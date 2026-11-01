import { Button } from '../components/primitives';
import LayoutScreen from '../ui/LayoutScreen';
import { usePageTitle } from '../utils/usePageTitle';

/**
 * Shown to anyone who reaches an authoring tool (the Guided Match recorder or annotator) by its URL without being the
 * admin. The buttons that open those tools only render in the admin view; the URL used to be open to everyone.
 */
export default function AuthoringToolLockedScreen({ onBack }: { onBack: () => void }) {
  usePageTitle('Not available');
  return (
    <LayoutScreen
      className="screen lobby-screen mode-subpage-screen"
      headingLevel={1}
      title="Not available"
      subtitle="This tool is only for the Racehorse team."
    >
      <Button variant="secondary" className="rh-back-button" data-rh-parent-back onClick={onBack}>
        ← Back to Learn
      </Button>
    </LayoutScreen>
  );
}
