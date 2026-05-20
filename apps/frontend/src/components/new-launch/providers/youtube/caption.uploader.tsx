'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { Dashboard, FileInput } from '@uppy/react';
import { useUppyUploader } from '@gitroom/frontend/components/media/new.uploader';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
// TODO: import { CaptionMediaDto } from '@gitroom/nestjs-libraries/dtos/media/caption.media.dto';
// Backend peer is producing CaptionMediaDto in the same feature; until that lands,
// this component emits a value of the same shape as MediaDto (id, path, alt?, thumbnail?).

const ALLOWED_FILE_TYPES =
  '.srt,.vtt,text/vtt,application/x-subrip,application/octet-stream';

type CaptionValue = {
  id: string;
  path: string;
  alt?: string;
  thumbnail?: string;
};

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
      <div className="text-[14px]">{label}</div>
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
            id={`caption-uploader-${name}`}
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
