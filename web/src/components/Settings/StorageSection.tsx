import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useInstance } from "@/contexts/InstanceContext";
import { InstanceSetting_StorageSetting_StorageType } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import SettingRow from "./SettingRow";
import SettingSection from "./SettingSection";

const StorageSection = () => {
  const t = useTranslate();
  const { storageSetting } = useInstance();

  return (
    <SettingSection title={t("setting.storage.label")}>
      <p className="mb-4 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-50">
        {t("setting.storage.not-implemented-hint")}
      </p>
      <fieldset disabled className="min-w-0 border-0 p-0 m-0">
        <div className="space-y-0 opacity-60">
          <SettingGroup title={t("setting.storage.current-storage")}>
            <div className="w-full">
              <RadioGroup
                value={String(storageSetting.storageType)}
                className="flex flex-row gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value={String(InstanceSetting_StorageSetting_StorageType.DATABASE)} id="database" />
                  <Label htmlFor="database">{t("setting.storage.type-database")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value={String(InstanceSetting_StorageSetting_StorageType.LOCAL)} id="local" />
                  <Label htmlFor="local">{t("setting.storage.type-local")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value={String(InstanceSetting_StorageSetting_StorageType.S3)} id="s3" />
                  <Label htmlFor="s3">S3</Label>
                </div>
              </RadioGroup>
            </div>

            <SettingRow label={t("setting.system.max-upload-size")} tooltip={t("setting.system.max-upload-size-hint")}>
              <Input className="w-24 font-mono" readOnly value={String(storageSetting.uploadSizeLimitMb)} />
            </SettingRow>

            {storageSetting.storageType !== InstanceSetting_StorageSetting_StorageType.DATABASE && (
              <SettingRow label={t("setting.storage.filepath-template")}>
                <Input
                  className="w-64"
                  readOnly
                  value={storageSetting.filepathTemplate}
                  placeholder="assets/{timestamp}_{filename}"
                />
              </SettingRow>
            )}
          </SettingGroup>

          {storageSetting.storageType === InstanceSetting_StorageSetting_StorageType.S3 && (
            <SettingGroup title="S3 Configuration" showSeparator>
              <SettingRow label={t("setting.storage.accesskey")}>
                <Input className="w-64" readOnly value={storageSetting.s3Config?.accessKeyId ?? ""} />
              </SettingRow>

              <SettingRow label={t("setting.storage.secretkey")}>
                <Input className="w-64" type="password" readOnly value={storageSetting.s3Config?.accessKeySecret ?? ""} />
              </SettingRow>

              <SettingRow label={t("setting.storage.endpoint")}>
                <Input className="w-64" readOnly value={storageSetting.s3Config?.endpoint ?? ""} />
              </SettingRow>

              <SettingRow label={t("setting.storage.region")}>
                <Input className="w-64" readOnly value={storageSetting.s3Config?.region ?? ""} />
              </SettingRow>

              <SettingRow label={t("setting.storage.bucket")}>
                <Input className="w-64" readOnly value={storageSetting.s3Config?.bucket ?? ""} />
              </SettingRow>

              <SettingRow label="Use Path Style">
                <Switch checked={storageSetting.s3Config?.usePathStyle ?? false} disabled />
              </SettingRow>
            </SettingGroup>
          )}
        </div>
      </fieldset>
    </SettingSection>
  );
};

export default StorageSection;
