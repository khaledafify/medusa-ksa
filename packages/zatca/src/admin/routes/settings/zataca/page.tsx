import { Text } from "@medusajs/ui";
import type React from "react";
import { useEffect } from "react";

const ZatcaSettingsAliasPage = (): React.JSX.Element => {
  useEffect(() => {
    window.location.replace("/app/settings/zatca");
  }, []);

  return (
    <div className="flex min-h-[240px] items-center justify-center">
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        Opening ZATCA settings...
      </Text>
    </div>
  );
};

export default ZatcaSettingsAliasPage;
