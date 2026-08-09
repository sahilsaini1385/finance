import React, { useRef, useState } from 'react'
import Icon from './Icon.jsx'

// Shared drag-and-drop / click-to-browse file target.
export default function FileDrop({ onFile, accept, title, subtitle }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  return (
    <>
      <div
        className={over ? 'dropzone over' : 'dropzone'}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0]) }}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
      >
        <Icon name="upload" size={24} />
        <strong>{title}</strong>
        {subtitle && <span className="small">{subtitle}</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={e => { onFile(e.target.files?.[0]); e.target.value = '' }}
      />
    </>
  )
}
