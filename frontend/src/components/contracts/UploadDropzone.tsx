import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { CheckCircle2, FileUp, TriangleAlert, Upload, X } from 'lucide-react';

import Button from '@/components/ui/Button';
import ToggleSwitch from '@/components/contracts/ToggleSwitch';
import { ACCEPT_ATTR, ACCEPTED_EXTENSIONS, formatBytes, isAcceptedFile } from '@/components/contracts/helpers';
import { ApiError, uploadContract } from '@/lib/api';
import { cn } from '@/lib/format';
import type { ContractSummary } from '@/lib/types';

type UploadState = 'queued' | 'uploading' | 'done' | 'error';

interface UploadItem {
  id: string;
  name: string;
  size: number;
  state: UploadState;
  message: string | null;
  contractId: string | null;
}

export interface UploadDropzoneProps {
  /** Called once per successfully ingested contract, so the table can refetch. */
  onUploaded?: (contract: ContractSummary) => void;
  className?: string;
}

const STATE_LABEL: Record<UploadState, string> = {
  queued: 'Queued',
  uploading: 'Uploading & analysing…',
  done: 'Ingested',
  error: 'Failed',
};

const BAR: Record<UploadState, string> = {
  queued: 'w-0 bg-muted',
  uploading: 'w-full shimmer motion-safe:animate-shimmer bg-[rgb(var(--accent-rgb)/0.5)]',
  done: 'w-full bg-grounded',
  error: 'w-full bg-ungrounded',
};

/**
 * Drag-and-drop ingest. Files are uploaded one at a time through `uploadContract`
 * so a dropped folder cannot stampede the pipeline; every file carries its own
 * state and its own error message.
 */
export default function UploadDropzone({ onUploaded, className }: UploadDropzoneProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [analyze, setAnalyze] = useState(true);
  const [verifierEnabled, setVerifierEnabled] = useState(true);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const queueRef = useRef<{ id: string; file: File }[]>([]);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const dragDepth = useRef(0);
  const seqRef = useRef(0);

  const analyzeRef = useRef(analyze);
  const verifierRef = useRef(verifierEnabled);
  const onUploadedRef = useRef(onUploaded);

  useEffect(() => {
    analyzeRef.current = analyze;
  }, [analyze]);
  useEffect(() => {
    verifierRef.current = verifierEnabled;
  }, [verifierEnabled]);
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }, []);

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const next = queueRef.current.shift();
        if (!next) break;
        if (!mountedRef.current) break;

        patch(next.id, { state: 'uploading', message: null });
        try {
          const contract = await uploadContract(next.file, {
            analyze: analyzeRef.current,
            verifier_enabled: verifierRef.current,
          });
          if (!mountedRef.current) break;
          patch(next.id, { state: 'done', message: contract.title, contractId: contract.id });
          onUploadedRef.current?.(contract);
        } catch (error) {
          if (!mountedRef.current) break;
          const message =
            error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : 'Upload failed';
          patch(next.id, { state: 'error', message });
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [patch]);

  const enqueue = useCallback(
    (files: FileList | File[] | null) => {
      const list = files ? Array.from(files) : [];
      if (list.length === 0) return;

      const accepted: UploadItem[] = [];
      const rejected: UploadItem[] = [];

      for (const file of list) {
        seqRef.current += 1;
        const id = `${Date.now()}-${seqRef.current}`;
        if (isAcceptedFile(file)) {
          accepted.push({
            id,
            name: file.name,
            size: file.size,
            state: 'queued',
            message: null,
            contractId: null,
          });
          queueRef.current.push({ id, file });
        } else {
          rejected.push({
            id,
            name: file.name,
            size: file.size,
            state: 'error',
            message: `Unsupported file type — ClauseGuard reads ${ACCEPTED_EXTENSIONS.join(', ')}`,
            contractId: null,
          });
        }
      }

      setItems((previous) => [...previous, ...accepted, ...rejected]);
      if (accepted.length > 0) void pump();
    },
    [pump],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      enqueue(event.dataTransfer?.files ?? null);
    },
    [enqueue],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);

  const onPick = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      enqueue(event.target.files);
      event.target.value = '';
    },
    [enqueue],
  );

  const settled = items.filter((item) => item.state === 'done' || item.state === 'error').length;

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-7 text-center',
          'transition-colors duration-240 ease-instrument',
          dragging
            ? 'border-accent bg-[rgb(var(--accent-rgb)/0.08)]'
            : 'border-border bg-[rgb(var(--surface-rgb)/0.02)]',
        )}
      >
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full border',
            dragging
              ? 'border-[rgb(var(--accent-rgb)/0.45)] bg-[rgb(var(--accent-rgb)/0.12)] text-accent'
              : 'border-border bg-surface text-muted',
          )}
        >
          <Upload aria-hidden="true" className="h-5 w-5" />
        </span>

        <p className="text-sm font-medium text-text">Drop contracts to ingest</p>
        <p className="max-w-xs text-xs leading-relaxed text-muted">
          {ACCEPTED_EXTENSIONS.join(' · ')} — each file is segmented, prefiltered and every
          extracted obligation is re-checked against its source clause.
        </p>

        <Button
          variant="secondary"
          size="sm"
          iconLeft={<FileUp aria-hidden="true" className="h-3.5 w-3.5" />}
          onClick={() => inputRef.current?.click()}
        >
          Browse files
        </Button>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          onChange={onPick}
          className="sr-only"
          aria-label="Choose contract files to upload"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleSwitch
          checked={analyze}
          onChange={setAnalyze}
          label="Analyse on upload"
          description="Run the extraction pipeline as soon as the file is ingested"
        />
        <ToggleSwitch
          checked={verifierEnabled}
          onChange={setVerifierEnabled}
          label={verifierEnabled ? 'Verifier on' : 'Verifier off'}
          description="Re-check every extracted obligation against its source clause"
          disabled={!analyze}
        />
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-border bg-surface p-2.5">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-xs text-text" title={item.name}>
                  {item.name}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[11px] tabular-nums text-muted">
                    {formatBytes(item.size)}
                  </span>
                  {item.state === 'done' && (
                    <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-grounded" />
                  )}
                  {item.state === 'error' && (
                    <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 text-ungrounded" />
                  )}
                </span>
              </div>

              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[rgb(var(--surface-rgb)/0.08)]">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-320 ease-instrument', BAR[item.state])}
                />
              </div>

              <p
                className={cn(
                  'mt-1.5 truncate text-[11px]',
                  item.state === 'error' ? 'text-ungrounded' : 'text-muted',
                )}
                title={item.message ?? STATE_LABEL[item.state]}
              >
                {item.state === 'error' || item.state === 'done'
                  ? (item.message ?? STATE_LABEL[item.state])
                  : STATE_LABEL[item.state]}
              </p>
            </li>
          ))}
        </ul>
      )}

      {settled > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          iconLeft={<X aria-hidden="true" className="h-3.5 w-3.5" />}
          onClick={() =>
            setItems((previous) =>
              previous.filter((item) => item.state === 'queued' || item.state === 'uploading'),
            )
          }
        >
          Clear finished ({settled})
        </Button>
      )}
    </div>
  );
}
