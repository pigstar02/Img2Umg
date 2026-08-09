#include "Img2UmgEditorModule.h"

#include "DesktopPlatformModule.h"
#include "Framework/Application/SlateApplication.h"
#include "IDesktopPlatform.h"
#include "Img2UmgImporter.h"
#include "Misc/MessageDialog.h"
#include "ToolMenus.h"

#define LOCTEXT_NAMESPACE "FImg2UmgEditorModule"

void FImg2UmgEditorModule::StartupModule()
{
    UToolMenus::RegisterStartupCallback(
        FSimpleMulticastDelegate::FDelegate::CreateRaw(this, &FImg2UmgEditorModule::RegisterMenus));
}

void FImg2UmgEditorModule::ShutdownModule()
{
    UToolMenus::UnRegisterStartupCallback(this);
    UToolMenus::UnregisterOwner(this);
}

void FImg2UmgEditorModule::RegisterMenus()
{
    FToolMenuOwnerScoped OwnerScoped(this);
    UToolMenu* Menu = UToolMenus::Get()->ExtendMenu("LevelEditor.MainMenu.Tools");
    FToolMenuSection& Section = Menu->FindOrAddSection("Img2Umg");
    Section.AddMenuEntry(
        "Img2UmgImportPackage",
        LOCTEXT("ImportLabel", "Import Img2Umg UI Package..."),
        LOCTEXT("ImportTooltip", "Choose a ui.manifest.json and generate Widget Blueprints."),
        FSlateIcon(),
        FUIAction(FExecuteAction::CreateRaw(this, &FImg2UmgEditorModule::OpenImportDialog)));
}

void FImg2UmgEditorModule::OpenImportDialog()
{
    IDesktopPlatform* DesktopPlatform = FDesktopPlatformModule::Get();
    if (!DesktopPlatform)
    {
        FMessageDialog::Open(EAppMsgType::Ok, LOCTEXT("NoDesktopPlatform", "The desktop file dialog is unavailable."));
        return;
    }

    const void* ParentHandle = FSlateApplication::Get().FindBestParentWindowHandleForDialogs(nullptr);
    TArray<FString> Files;
    const bool bSelected = DesktopPlatform->OpenFileDialog(
        ParentHandle,
        TEXT("Import Img2Umg package"),
        FString(),
        TEXT("ui.manifest.json"),
        TEXT("Img2Umg manifest (*.json)|*.json"),
        EFileDialogFlags::None,
        Files);

    if (!bSelected || Files.IsEmpty())
    {
        return;
    }

    FImg2UmgImporter Importer;
    FText Error;
    if (!Importer.ImportManifest(Files[0], Error))
    {
        FMessageDialog::Open(EAppMsgType::Ok, Error, LOCTEXT("ImportFailed", "Img2Umg import failed"));
        return;
    }

    FMessageDialog::Open(
        EAppMsgType::Ok,
        FText::Format(LOCTEXT("ImportSucceeded", "Generated Widget Blueprints in {0}."), FText::FromString(Importer.GetOutputPath())));
}

IMPLEMENT_MODULE(FImg2UmgEditorModule, Img2UmgEditor)

#undef LOCTEXT_NAMESPACE
