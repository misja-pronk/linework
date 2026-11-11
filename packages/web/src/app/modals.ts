// The one dialog that takes the stage (palette, start, problems, connect, the keys) and the describe dialog.
import { useEffect, useState } from 'react';
import { served } from '../live/serve.ts';
import { store } from '../store.ts';

export type Modal = 'palette' | 'templates' | 'problems' | 'connect' | 'shortcuts';

/** `onOpen`: a dialog takes the stage, so a message about the page under it goes. */
export function useModals(onOpen: () => void) {
  // A first visit starts with choosing what to make and how.
  // The start dialog only until it has been left once (by any way: a template, a file, Esc).
  // Opened by carto serve, the folder's first diagram opens instead.
  const [modal, setModal] = useState<Modal | undefined>(() => (store.get('started') || served() ? undefined : 'templates'));
  // A dialog takes the stage: a message about the page under it goes (what the dialog itself says shows on top).
  // Once the start dialog is left, by whatever way, it is not shown at the next launch.
  useEffect(() => {
    if (modal) onOpen();
    else store.set('started', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the dialog changes, whatever onOpen is by then
  }, [modal]);
  const [describing, setDescribing] = useState(false);
  /** Opened from the type pill: the dialog marks the open diagram's type. */
  const [guiding, setGuiding] = useState(false);
  const closeModal = () => {
    setModal(undefined);
    setGuiding(false);
    store.set('started', true);
  };
  return { modal, setModal, closeModal, describing, setDescribing, guiding, setGuiding };
}
export type Modals = ReturnType<typeof useModals>;
