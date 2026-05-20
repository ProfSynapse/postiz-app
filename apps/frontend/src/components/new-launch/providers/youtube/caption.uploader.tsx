'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Dashboard, FileInput } from '@uppy/react';
import { useUppyUploader } from '@gitroom/frontend/components/media/new.uploader';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import type { CaptionMediaDto } from '@gitroom/nestjs-libraries/dtos/media/caption.media.dto';

const ALLOWED_FILE_TYPES =
  '.srt,.vtt,text/vtt,application/x-subrip,application/octet-stream';

type CaptionValue = CaptionMediaDto;

export const CaptionUploader: FC<{
  label: string;
  description?: string;
  name: string;
  value?: CaptionValue;
  onChange: (event: {
    target: {
      name: string;
      value?: CaptionValue;
    };
  }) => void;
}> = (props) => {
  const { label, description, name, value, onChange } = props;
  const t = useT();
  const toast = useToaster();
  const fileInputId = `caption-uploader-${name}`;
  const [currentCaption, setCurrentCaption] = useState<CaptionValue | undefined>(
    value
  );

  useEffect(() => {
    setCurrentCaption(value);
  }, [value]);

  const handleUploadSuccess = useCallback(
    (result: any) => {
      // useUppyUploader's onUploadSuccess callback returns an array of saved
      // media records (see new.uploader.tsx lines 207/234/239). Captions is a
      // single file, so we take the first entry.
      const first = Array.isArray(result) ? result[0] : result;
      if (!first?.id || !first?.path) {
        return;
      }
      const next: CaptionValue = {
        id: first.id,
        path: first.path,
        ...(first.alt ? { alt: first.alt } : {}),
        ...(first.thumbnail ? { thumbnail: first.thumbnail } : {}),
      };
      setCurrentCaption(next);
      onChange({ target: { name, value: next } });
    },
    [name, onChange]
  );

  const uppy = useUppyUploader({
    allowedFileTypes: ALLOWED_FILE_TYPES,
    onUploadSuccess: handleUploadSuccess,
  });

  useEffect(() => {
    const handleUploadError = () => {
      toast.show(
        t(
          'caption_upload_failed',
          'Caption upload failed. Please try selecting the file again.'
        ),
        'warning'
      );
    };
    uppy.on('upload-error', handleUploadError);
    uppy.on('restriction-failed', handleUploadError);
    return () => {
      uppy.off('upload-error', handleUploadError);
      uppy.off('restriction-failed', handleUploadError);
    };
  }, [uppy, toast, t]);

  const clearCaption = useCallback(() => {
    setCurrentCaption(undefined);
    onChange({ target: { name, value: undefined } });
  }, [name, onChange]);

  const fileNameFromPath = useMemo(() => {
    if (!currentCaption?.path) return '';
    const segments = currentCaption.path.split('/');
    return segments[segments.length - 1] || currentCaption.path;
  }, [currentCaption?.path]);

  return (
    <div className="flex flex-col gap-[8px]">
      <label htmlFor={fileInputId} className="text-[14px]">
        {label}
      </label>
      {!!description && <div className="text-[12px]">{description}</div>}
      {!!currentCaption?.path && (
        <div className="text-[12px] text-textColor break-all">
          {fileNameFromPath}
        </div>
      )}
      <div className="w-full pointer-events-none relative">
        <div className="w-full h-[46px] overflow-hidden bg-newBgColorInner uppyChange">
          <Dashboard
            height={46}
            uppy={uppy}
            id={fileInputId}
            showProgressDetails={true}
            hideUploadButton={true}
            hideRetryButton={true}
            hidePauseResumeButton={true}
            hideCancelButton={true}
            hideProgressAfterFinish={true}
          />
        </div>
      </div>
      <div className="flex gap-[5px]">
        <FileInput
          uppy={uppy}
          locale={{
            strings: {
              chooseFiles: t(
                'select_caption_file',
                'Select caption file (.srt or .vtt)'
              ),
            },
            // @ts-ignore
            pluralize: (n: any) => n,
          }}
        />
        {!!currentCaption && (
          <Button secondary={true} onClick={clearCaption}>
            {t('clear', 'Clear')}
          </Button>
        )}
      </div>
    </div>
  );
};
