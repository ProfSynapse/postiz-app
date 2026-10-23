'use client';

import { StandaloneModal } from '@gitroom/frontend/components/standalone-modal/standalone.modal';
import { usePathname } from 'next/navigation';
export default function Modal() {
  return (
    <div className="text-textColor">
      <StandaloneModal />
    </div>
  );
}
