import React, {useEffect, useRef} from 'react';

// A scroll is never a long press. Keep taps and keyboard activation available.
export default function ChatImage({attachment, onOpen}) {
  const timer = useRef(null);
  const pointer = useRef(null);
  const suppressClickUntil = useRef(0);
  const cancel = () => { clearTimeout(timer.current); timer.current = null; };
  useEffect(() => {
    const onScroll = () => { cancel(); pointer.current = null; };
    window.addEventListener('scroll', onScroll, true);
    return () => { cancel(); window.removeEventListener('scroll', onScroll, true); };
  }, []);
  return <button type="button" className="message-image chat-image-action"
    aria-label={`查看图片：${attachment.name || '聊天图片'}，长按或右键可收藏为表情`}
    title="点开看大图 · 长按或右键收藏表情" data-testid={`chat-image-${attachment.id}`}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      cancel();
      pointer.current = {x:event.clientX, y:event.clientY, id:event.pointerId};
      timer.current = setTimeout(() => {
        pointer.current = null;
        suppressClickUntil.current = Date.now() + 800;
        onOpen();
      }, 500);
    }}
    onPointerMove={event => {
      const start = pointer.current;
      if (start && Math.hypot(event.clientX-start.x, event.clientY-start.y) > 12) {
        cancel(); pointer.current = null; suppressClickUntil.current = Date.now()+800;
      }
    }}
    onPointerUp={() => { cancel(); pointer.current = null; }}
    onPointerCancel={() => { cancel(); pointer.current = null; suppressClickUntil.current = Date.now()+800; }}
    onPointerLeave={cancel}
    onContextMenu={event => {
      event.preventDefault(); cancel();
      // Android can dispatch a native contextmenu after our long-press timer.
      if (Date.now() >= suppressClickUntil.current) onOpen();
      suppressClickUntil.current = Date.now()+800;
    }}
    onClick={event => {
      if (event.detail !== 0 && Date.now() < suppressClickUntil.current) { event.preventDefault(); return; }
      onOpen();
    }}>
    <img src={attachment.url} alt={attachment.name || '聊天图片'} loading="lazy" draggable="false"/>
  </button>;
}
