#pragma once

#include "Modules/ModuleManager.h"

class FImg2UmgEditorModule final : public IModuleInterface
{
public:
    virtual void StartupModule() override;
    virtual void ShutdownModule() override;

private:
    void RegisterMenus();
    void OpenImportDialog();
    void OpenV2ImportDialog();
};
