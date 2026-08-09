#pragma once

#include "CoreMinimal.h"

class UPanelWidget;
class UWidget;
class UWidgetBlueprint;
class UWidgetTree;
class FJsonObject;

class FImg2UmgImporter
{
public:
    bool ImportManifest(const FString& ManifestFilename, FText& OutError);
    const FString& GetOutputPath() const { return OutputPath; }

private:
    struct FAssetSpec
    {
        FString Id;
        FString File;
    };

    bool ReadJsonFile(const FString& Filename, TSharedPtr<FJsonObject>& OutObject, FString& OutError) const;
    bool ReadAssetSpecs(const TSharedPtr<FJsonObject>& Manifest, const TCHAR* Field, TArray<FAssetSpec>& OutSpecs, FString& OutError) const;
    bool CreateEntry(const FAssetSpec& Spec, FString& OutError);
    bool CreateScreen(const FAssetSpec& Spec, FString& OutError);
    bool CreateWidgetBlueprint(const FString& Id, const TSharedPtr<FJsonObject>& Document, bool bEntry, UWidgetBlueprint*& OutBlueprint, FString& OutError);
    bool BuildWidget(UWidgetBlueprint* Blueprint, UWidgetTree* Tree, const TSharedPtr<FJsonObject>& Node, UPanelWidget* Parent, UWidget*& OutWidget, FString& OutError);
    bool ApplyCommonProperties(UWidget* Widget, const TSharedPtr<FJsonObject>& Props, TSet<FString>& Used, FString& OutError);
    bool ApplyWidgetProperties(UWidget* Widget, const FString& Type, const TSharedPtr<FJsonObject>& Props, TSet<FString>& Used, FString& OutError);
    bool ApplySlotProperties(UWidget* Widget, UPanelWidget* Parent, const TSharedPtr<FJsonObject>& Slot, FString& OutError);
    bool ValidateUnused(const TSharedPtr<FJsonObject>& Object, const TSet<FString>& Used, const FString& Context, FString& OutError) const;
    bool SaveAndCompile(UWidgetBlueprint* Blueprint, FString& OutError) const;
    bool AddEntryInterface(UWidgetBlueprint* Blueprint, FString& OutError) const;
    bool ResolveEntryClass(const FString& Id, UClass*& OutClass, FString& OutError) const;
    int32 ReadPreviewCount(const FString& PreviewId, const FString& ExpectedEntryId, FString& OutError) const;

    FString ManifestDirectory;
    FString OutputPath;
    TMap<FString, UWidgetBlueprint*> EntryBlueprints;
    TMap<FString, FString> PreviewFiles;
};
