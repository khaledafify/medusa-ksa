import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
  ArrowPathMini,
  BellAlert,
  CheckCircle,
  DocumentText,
  ExclamationCircle,
  PaperPlane,
} from "@medusajs/icons";
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  StatusBadge,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  listNotificationTemplates,
  previewNotificationTemplate,
  sendTestNotification,
  updateNotificationTemplate,
  type NotificationTemplatesResponse,
} from "../../../lib/notification-template-client";

const ROUTE_CONFIG = {
  LABEL: "Notifications",
} as const;

const QUERY_KEYS = {
  TEMPLATES: ["notification-templates"] as const,
  PREVIEW: (id: string) => ["notification-templates", id, "preview"] as const,
} as const;

const SEND_TEST_STATUS = {
  SKIPPED: "skipped",
} as const;

const UI_TEXT = {
  TITLE: "Notifications",
  SUBTITLE: "Order SMS templates",
  TEMPLATE_LIST: "Templates",
  BODY: "Body",
  SENDER: "Sender",
  PREVIEW: "Sample preview",
  SAVE: "Save",
  SAVING: "Saving",
  REFRESH: "Refresh",
  REFRESHING: "Refreshing",
  SEND_TEST: "Send test",
  SENDING: "Sending",
  TEST_PHONE: "Test phone",
  EMPTY: "No notification templates found.",
  LOADING: "Loading templates",
  SELECT_TEMPLATE: "Select a template",
  ENABLED_LABEL: "Enabled",
  DISABLED_LABEL: "Disabled",
  STORED: "Stored row",
  PREVIEW_PLACEHOLDER: "Preview renders after selecting a stored template.",
  FROM_PLACEHOLDER: "Optional sender",
  PHONE_PLACEHOLDER: "+9665XXXXXXXX",
  SAVE_SUCCESS: "Notification template saved",
  SAVE_ERROR: "Template save failed",
  SEND_SUCCESS: "Test notification created",
  SEND_SKIPPED: "Live send-test skipped",
  SEND_ERROR: "Test notification failed",
  PREVIEW_ERROR: "Preview failed",
} as const;

interface TemplateDraft {
  body: string;
  enabled: boolean;
  from: string;
}

const EMPTY_DRAFT = {
  body: "",
  enabled: false,
  from: "",
} satisfies TemplateDraft;

/** Native Medusa Admin settings page for order notification templates. */
function NotificationsSettingsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT);
  const [testPhone, setTestPhone] = useState("");

  const templatesQuery = useQuery({
    queryKey: QUERY_KEYS.TEMPLATES,
    queryFn: () => listNotificationTemplates(),
  });

  const templates = templatesQuery.data?.templates ?? [];

  useEffect(() => {
    if (!selectedTemplateId && templates[0]) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [selectedTemplateId, templates]);

  const selectedTemplate = useMemo(
    () =>
      templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  useEffect(() => {
    if (!selectedTemplate) {
      setDraft(EMPTY_DRAFT);
      return;
    }

    setDraft({
      body: selectedTemplate.body,
      enabled: selectedTemplate.enabled,
      from: selectedTemplate.from ?? "",
    });
  }, [selectedTemplate]);

  const previewQuery = useQuery({
    queryKey: selectedTemplateId
      ? QUERY_KEYS.PREVIEW(selectedTemplateId)
      : QUERY_KEYS.PREVIEW(UI_TEXT.SELECT_TEMPLATE),
    enabled: Boolean(selectedTemplateId),
    queryFn: () => previewNotificationTemplate(selectedTemplateId ?? ""),
  });

  const updateMutation = useMutation({
    mutationFn: (input: TemplateDraft) => {
      if (!selectedTemplateId) {
        throw new Error(UI_TEXT.SELECT_TEMPLATE);
      }

      return updateNotificationTemplate(selectedTemplateId, {
        body: input.body,
        enabled: input.enabled,
        from: input.from.trim() || null,
      });
    },
    onSuccess: (response) => {
      queryClient.setQueryData<NotificationTemplatesResponse>(
        QUERY_KEYS.TEMPLATES,
        (current) => {
          const currentTemplates = current?.templates ?? [];
          return {
            templates: currentTemplates.map((template) =>
              template.id === response.template.id
                ? response.template
                : template,
            ),
          };
        },
      );
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.PREVIEW(response.template.id),
      });
      toast.success(UI_TEXT.SAVE_SUCCESS);
    },
    onError: () => {
      toast.error(UI_TEXT.SAVE_ERROR);
    },
  });

  const sendTestMutation = useMutation({
    mutationFn: () => {
      if (!selectedTemplateId) {
        throw new Error(UI_TEXT.SELECT_TEMPLATE);
      }

      return sendTestNotification({
        id: selectedTemplateId,
        to: testPhone,
        live: true,
      });
    },
    onSuccess: (response) => {
      if (response.status === SEND_TEST_STATUS.SKIPPED) {
        toast.warning(`${UI_TEXT.SEND_SKIPPED}: ${response.reason ?? ""}`);
        return;
      }

      toast.success(UI_TEXT.SEND_SUCCESS);
    },
    onError: () => {
      toast.error(UI_TEXT.SEND_ERROR);
    },
  });

  const preview = previewQuery.data?.preview ?? null;
  const isDirty =
    Boolean(selectedTemplate) &&
    (draft.body !== selectedTemplate?.body ||
      draft.enabled !== selectedTemplate?.enabled ||
      draft.from !== (selectedTemplate?.from ?? ""));

  const saveDraft = (): void => {
    updateMutation.mutate(draft);
  };

  const refreshPreview = (): void => {
    if (!selectedTemplateId) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: QUERY_KEYS.PREVIEW(selectedTemplateId),
    });
  };

  return (
    <div className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-1">
        <div className="flex items-center gap-x-2">
          <BellAlert className="text-ui-fg-subtle" />
          <Heading>{UI_TEXT.TITLE}</Heading>
        </div>
        <Text className="text-ui-fg-subtle" size="small">
          {UI_TEXT.SUBTITLE}
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
        <Container className="overflow-hidden p-0">
          <div className="border-ui-border-base flex items-center justify-between border-b px-6 py-4">
            <div>
              <Heading level="h2">{UI_TEXT.TEMPLATE_LIST}</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                {templates.length} {UI_TEXT.STORED}
              </Text>
            </div>
            {templatesQuery.isFetching ? (
              <ArrowPathMini className="text-ui-fg-muted animate-spin" />
            ) : (
              <DocumentText className="text-ui-fg-muted" />
            )}
          </div>

          <div className="divide-ui-border-base divide-y">
            {templatesQuery.isLoading ? (
              <TemplateListState label={UI_TEXT.LOADING} />
            ) : templates.length === 0 ? (
              <TemplateListState label={UI_TEXT.EMPTY} />
            ) : (
              templates.map((template) => (
                <button
                  className="hover:bg-ui-bg-subtle flex w-full items-center justify-between gap-x-4 px-6 py-4 text-left"
                  key={template.id}
                  onClick={() => setSelectedTemplateId(template.id)}
                  type="button"
                >
                  <div className="flex min-w-0 flex-col gap-y-1">
                    <Text
                      className="truncate text-ui-fg-base"
                      size="small"
                      weight="plus"
                    >
                      {template.event}
                    </Text>
                    <div className="flex items-center gap-x-2">
                      <Badge color="grey" size="2xsmall">
                        {template.channel}
                      </Badge>
                      <Badge color="grey" size="2xsmall">
                        {template.locale}
                      </Badge>
                    </div>
                  </div>
                  <StatusBadge color={template.enabled ? "green" : "grey"}>
                    {template.enabled
                      ? UI_TEXT.ENABLED_LABEL
                      : UI_TEXT.DISABLED_LABEL}
                  </StatusBadge>
                </button>
              ))
            )}
          </div>
        </Container>

        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <Container className="p-0">
            <div className="border-ui-border-base flex items-start justify-between gap-x-4 border-b px-6 py-4">
              <div className="flex min-w-0 flex-col gap-y-1">
                <Heading level="h2">
                  {selectedTemplate?.event ?? UI_TEXT.SELECT_TEMPLATE}
                </Heading>
                <Text className="text-ui-fg-subtle" size="small">
                  {selectedTemplate?.channel ?? ""} /{" "}
                  {selectedTemplate?.locale ?? ""}
                </Text>
              </div>
              <div className="flex items-center gap-x-2">
                <StatusBadge color={draft.enabled ? "green" : "grey"}>
                  {draft.enabled
                    ? UI_TEXT.ENABLED_LABEL
                    : UI_TEXT.DISABLED_LABEL}
                </StatusBadge>
                <Switch
                  checked={draft.enabled}
                  disabled={!selectedTemplate}
                  onCheckedChange={(enabled) =>
                    setDraft((current) => ({ ...current, enabled }))
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-y-5 px-6 py-5">
              <div className="flex flex-col gap-y-2">
                <Label htmlFor="notification-body">{UI_TEXT.BODY}</Label>
                <Textarea
                  className="min-h-[220px] resize-y font-mono"
                  disabled={!selectedTemplate}
                  id="notification-body"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      body: event.target.value,
                    }))
                  }
                  value={draft.body}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-y-2">
                  <Label htmlFor="notification-sender">
                    {UI_TEXT.SENDER}
                  </Label>
                  <Input
                    disabled={!selectedTemplate}
                    id="notification-sender"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        from: event.target.value,
                      }))
                    }
                    placeholder={UI_TEXT.FROM_PLACEHOLDER}
                    value={draft.from}
                  />
                </div>
                <div className="flex flex-col gap-y-2">
                  <Label htmlFor="notification-phone">
                    {UI_TEXT.TEST_PHONE}
                  </Label>
                  <Input
                    disabled={!selectedTemplate}
                    id="notification-phone"
                    onChange={(event) => setTestPhone(event.target.value)}
                    placeholder={UI_TEXT.PHONE_PLACEHOLDER}
                    value={testPhone}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={!selectedTemplate || !isDirty}
                  isLoading={updateMutation.isPending}
                  onClick={saveDraft}
                  type="button"
                >
                  {updateMutation.isPending ? UI_TEXT.SAVING : UI_TEXT.SAVE}
                </Button>
                <Button
                  disabled={!selectedTemplate || isDirty}
                  isLoading={previewQuery.isFetching}
                  onClick={refreshPreview}
                  type="button"
                  variant="secondary"
                >
                  {previewQuery.isFetching
                    ? UI_TEXT.REFRESHING
                    : UI_TEXT.REFRESH}
                </Button>
                <Button
                  disabled={!selectedTemplate || !testPhone.trim() || isDirty}
                  isLoading={sendTestMutation.isPending}
                  onClick={() => sendTestMutation.mutate()}
                  type="button"
                  variant="secondary"
                >
                  <PaperPlane />
                  {sendTestMutation.isPending
                    ? UI_TEXT.SENDING
                    : UI_TEXT.SEND_TEST}
                </Button>
              </div>
            </div>
          </Container>

          <Container className="p-0">
            <div className="border-ui-border-base flex items-center justify-between border-b px-6 py-4">
              <Heading level="h2">{UI_TEXT.PREVIEW}</Heading>
              {previewQuery.isError ? (
                <ExclamationCircle className="text-ui-tag-red-icon" />
              ) : (
                <CheckCircle className="text-ui-tag-green-icon" />
              )}
            </div>

            <div className="flex flex-col gap-y-4 px-6 py-5">
              <div
                className="bg-ui-bg-subtle border-ui-border-base min-h-[180px] rounded-md border p-4 text-right"
                dir="rtl"
              >
                <Text className="whitespace-pre-wrap leading-6">
                  {preview?.text ??
                    (previewQuery.isError
                      ? UI_TEXT.PREVIEW_ERROR
                      : UI_TEXT.PREVIEW_PLACEHOLDER)}
                </Text>
              </div>

              {preview ? (
                <div className="grid grid-cols-3 gap-2">
                  <PreviewMetric
                    label="Encoding"
                    value={preview.segments.encoding}
                  />
                  <PreviewMetric
                    label="Length"
                    value={String(preview.segments.length)}
                  />
                  <PreviewMetric
                    label="Segments"
                    value={String(preview.segments.segments)}
                  />
                </div>
              ) : null}

              {preview?.warnings.map((warning) => (
                <div
                  className="border-ui-border-base rounded-md border px-3 py-2"
                  key={warning.code}
                >
                  <Text className="text-ui-fg-subtle" size="small">
                    {warning.message}
                  </Text>
                </div>
              ))}
            </div>
          </Container>
        </div>
      </div>
    </div>
  );
}

interface TemplateListStateProps {
  label: string;
}

function TemplateListState({ label }: TemplateListStateProps): JSX.Element {
  return (
    <div className="px-6 py-8">
      <Text className="text-ui-fg-subtle" size="small">
        {label}
      </Text>
    </div>
  );
}

interface PreviewMetricProps {
  label: string;
  value: string;
}

function PreviewMetric({ label, value }: PreviewMetricProps): JSX.Element {
  return (
    <div className="border-ui-border-base rounded-md border px-3 py-2">
      <Text className="text-ui-fg-muted" size="xsmall">
        {label}
      </Text>
      <Text size="small" weight="plus">
        {value}
      </Text>
    </div>
  );
}

export const config = defineRouteConfig({
  label: ROUTE_CONFIG.LABEL,
});

export default NotificationsSettingsPage;
