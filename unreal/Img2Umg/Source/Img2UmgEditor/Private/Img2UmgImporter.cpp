#include "Img2UmgImporter.h"

#include "AssetRegistry/AssetRegistryModule.h"
#include "Blueprint/WidgetBlueprintGeneratedClass.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/BorderSlot.h"
#include "Components/Button.h"
#include "Components/ButtonSlot.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/Image.h"
#include "Components/ListView.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/ProgressBar.h"
#include "Components/ScaleBox.h"
#include "Components/ScaleBoxSlot.h"
#include "Components/SizeBox.h"
#include "Components/SizeBoxSlot.h"
#include "Components/Spacer.h"
#include "Components/TextBlock.h"
#include "Components/TileView.h"
#include "Blueprint/UserWidget.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Components/Widget.h"
#include "Engine/Texture2D.h"
#include "Engine/UserInterfaceSettings.h"
#include "WidgetBlueprintFactory.h"
#include "JsonObjectConverter.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "ObjectTools.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/SavePackage.h"
#include "Blueprint/IUserObjectListEntry.h"
#include "WidgetBlueprint.h"

namespace Img2Umg
{
static bool RequiredString(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field, FString& Out, FString& Error)
{
    if (!Object.IsValid() || !Object->TryGetStringField(Field, Out) || Out.IsEmpty())
    {
        Error = FString::Printf(TEXT("Missing or empty string '%s'."), Field);
        return false;
    }
    return true;
}

static bool NumberArray(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field, int32 Count, TArray<double>& Out, FString& Error)
{
    const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
    if (!Object->TryGetArrayField(Field, Values) || !Values || Values->Num() != Count)
    {
        Error = FString::Printf(TEXT("'%s' must be an array containing %d numbers."), Field, Count);
        return false;
    }
    Out.Reset(Count);
    for (const TSharedPtr<FJsonValue>& Value : *Values)
    {
        double Number = 0.0;
        if (!Value.IsValid() || !Value->TryGetNumber(Number))
        {
            Error = FString::Printf(TEXT("'%s' must contain only numbers."), Field);
            return false;
        }
        Out.Add(Number);
    }
    return true;
}

static bool Color(const FString& Value, FLinearColor& Out, FString& Error)
{
    if (!(Value.Len() == 7 || Value.Len() == 9) || !Value.StartsWith(TEXT("#")))
    {
        Error = FString::Printf(TEXT("Color '%s' must use #RRGGBB or #RRGGBBAA."), *Value);
        return false;
    }
    Out = FLinearColor(FColor::FromHex(Value));
    return true;
}

static bool OptionalColor(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field, FLinearColor& Out, bool& Found, FString& Error)
{
    FString Value;
    Found = Object->TryGetStringField(Field, Value);
    return !Found || Color(Value, Out, Error);
}

static bool Margin(const TSharedPtr<FJsonValue>& Value, FMargin& Out, FString& Error)
{
    if (!Value.IsValid())
    {
        Error = TEXT("Padding is missing.");
        return false;
    }
    double Uniform = 0.0;
    if (Value->TryGetNumber(Uniform))
    {
        Out = FMargin(Uniform);
        return true;
    }
    const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
    if (!Value->TryGetArray(Values) || !Values || (Values->Num() != 2 && Values->Num() != 4))
    {
        Error = TEXT("Padding must be a number, [horizontal, vertical], or [left, top, right, bottom].");
        return false;
    }
    TArray<double> N;
    for (const TSharedPtr<FJsonValue>& Item : *Values)
    {
        double Number = 0.0;
        if (!Item->TryGetNumber(Number))
        {
            Error = TEXT("Padding arrays must contain only numbers.");
            return false;
        }
        N.Add(Number);
    }
    Out = N.Num() == 2 ? FMargin(N[0], N[1]) : FMargin(N[0], N[1], N[2], N[3]);
    return true;
}

static EHorizontalAlignment HorizontalAlignment(const FString& Value, bool& Valid)
{
    Valid = true;
    if (Value == TEXT("left")) return HAlign_Left;
    if (Value == TEXT("center")) return HAlign_Center;
    if (Value == TEXT("right")) return HAlign_Right;
    if (Value == TEXT("fill")) return HAlign_Fill;
    Valid = false;
    return HAlign_Fill;
}

static EVerticalAlignment VerticalAlignment(const FString& Value, bool& Valid)
{
    Valid = true;
    if (Value == TEXT("top")) return VAlign_Top;
    if (Value == TEXT("center")) return VAlign_Center;
    if (Value == TEXT("bottom")) return VAlign_Bottom;
    if (Value == TEXT("fill")) return VAlign_Fill;
    Valid = false;
    return VAlign_Fill;
}

static bool SetObjectProperty(UObject* Object, const TCHAR* PropertyName, UObject* Value, FString& Error)
{
    FObjectPropertyBase* Property = FindFProperty<FObjectPropertyBase>(Object->GetClass(), PropertyName);
    if (!Property)
    {
        Error = FString::Printf(TEXT("This Unreal version does not expose property '%s' on %s."), PropertyName, *Object->GetClass()->GetName());
        return false;
    }
    Property->SetObjectPropertyValue_InContainer(Object, Value);
    return true;
}

static bool SetIntProperty(UObject* Object, const TCHAR* PropertyName, int32 Value, FString& Error)
{
    FIntProperty* Property = FindFProperty<FIntProperty>(Object->GetClass(), PropertyName);
    if (!Property)
    {
        Error = FString::Printf(TEXT("This Unreal version does not expose property '%s' on %s."), PropertyName, *Object->GetClass()->GetName());
        return false;
    }
    Property->SetPropertyValue_InContainer(Object, Value);
    return true;
}

static bool SetByteProperty(UObject* Object, const TCHAR* PropertyName, uint8 Value, FString& Error)
{
    FByteProperty* Property = FindFProperty<FByteProperty>(Object->GetClass(), PropertyName);
    if (!Property)
    {
        Error = FString::Printf(TEXT("This Unreal version does not expose property '%s' on %s."), PropertyName, *Object->GetClass()->GetName());
        return false;
    }
    Property->SetPropertyValue_InContainer(Object, Value);
    return true;
}
}

bool FImg2UmgImporter::ImportManifest(const FString& ManifestFilename, FText& OutError)
{
    FString Error;
    TSharedPtr<FJsonObject> Manifest;
    if (!ReadJsonFile(ManifestFilename, Manifest, Error))
    {
        OutError = FText::FromString(Error);
        return false;
    }

    FString Format;
    if (!Img2Umg::RequiredString(Manifest, TEXT("format"), Format, Error) || Format != TEXT("img2umg-package"))
    {
        OutError = FText::FromString(FString::Printf(TEXT("Unsupported manifest format '%s'. Expected 'img2umg-package'."), *Format));
        return false;
    }
    double VersionNumber = 0.0;
    if (!Manifest->TryGetNumberField(TEXT("version"), VersionNumber) || VersionNumber != 1.0)
    {
        OutError = FText::FromString(TEXT("Unsupported or missing manifest version. This plugin supports version 1."));
        return false;
    }

    ManifestDirectory = FPaths::GetPath(FPaths::ConvertRelativePathToFull(ManifestFilename));
    OutputPath = TEXT("/Game/Img2Umg");

    TSet<FString> ManifestFields{TEXT("format"), TEXT("version"), TEXT("screens"), TEXT("entries"), TEXT("previews")};
    if (!ValidateUnused(Manifest, ManifestFields, TEXT("manifest"), Error))
    {
        OutError = FText::FromString(Error);
        return false;
    }

    TArray<FAssetSpec> Entries;
    TArray<FAssetSpec> Screens;
    TArray<FAssetSpec> Previews;
    if (!ReadAssetSpecs(Manifest, TEXT("entries"), Entries, Error)
        || !ReadAssetSpecs(Manifest, TEXT("screens"), Screens, Error)
        || !ReadAssetSpecs(Manifest, TEXT("previews"), Previews, Error))
    {
        OutError = FText::FromString(Error);
        return false;
    }

    TSet<FString> Ids;
    PreviewFiles.Reset();
    for (const FAssetSpec& Preview : Previews)
    {
        if (Ids.Contains(Preview.Id))
        {
            OutError = FText::FromString(FString::Printf(TEXT("Duplicate asset id '%s'."), *Preview.Id));
            return false;
        }
        Ids.Add(Preview.Id);
        PreviewFiles.Add(Preview.Id, Preview.File);
    }
    for (const FAssetSpec& Entry : Entries)
    {
        if (Ids.Contains(Entry.Id))
        {
            OutError = FText::FromString(FString::Printf(TEXT("Duplicate asset id '%s'."), *Entry.Id));
            return false;
        }
        Ids.Add(Entry.Id);
        if (!CreateEntry(Entry, Error))
        {
            OutError = FText::FromString(FString::Printf(TEXT("Entry '%s': %s"), *Entry.Id, *Error));
            return false;
        }
    }
    for (const FAssetSpec& Screen : Screens)
    {
        if (Ids.Contains(Screen.Id))
        {
            OutError = FText::FromString(FString::Printf(TEXT("Duplicate asset id '%s'."), *Screen.Id));
            return false;
        }
        Ids.Add(Screen.Id);
        if (!CreateScreen(Screen, Error))
        {
            OutError = FText::FromString(FString::Printf(TEXT("Screen '%s': %s"), *Screen.Id, *Error));
            return false;
        }
    }
    return true;
}

bool FImg2UmgImporter::ReadJsonFile(const FString& Filename, TSharedPtr<FJsonObject>& OutObject, FString& OutError) const
{
    FString Text;
    if (!FFileHelper::LoadFileToString(Text, *Filename))
    {
        OutError = FString::Printf(TEXT("Cannot read JSON file: %s"), *Filename);
        return false;
    }
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
    if (!FJsonSerializer::Deserialize(Reader, OutObject) || !OutObject.IsValid())
    {
        OutError = FString::Printf(TEXT("Invalid JSON in %s: %s"), *Filename, *Reader->GetErrorMessage());
        return false;
    }
    return true;
}

bool FImg2UmgImporter::ReadAssetSpecs(const TSharedPtr<FJsonObject>& Manifest, const TCHAR* Field, TArray<FAssetSpec>& OutSpecs, FString& OutError) const
{
    const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
    if (!Manifest->TryGetArrayField(Field, Values) || !Values)
    {
        OutError = FString::Printf(TEXT("Manifest field '%s' must be an array."), Field);
        return false;
    }
    for (int32 Index = 0; Index < Values->Num(); ++Index)
    {
        const TSharedPtr<FJsonObject>* Object = nullptr;
        if (!(*Values)[Index]->TryGetObject(Object) || !Object || !Object->IsValid())
        {
            OutError = FString::Printf(TEXT("%s[%d] must be an object."), Field, Index);
            return false;
        }
        FAssetSpec& Spec = OutSpecs.AddDefaulted_GetRef();
        if (!Img2Umg::RequiredString(*Object, TEXT("id"), Spec.Id, OutError) || !Img2Umg::RequiredString(*Object, TEXT("file"), Spec.File, OutError))
        {
            OutError = FString::Printf(TEXT("%s[%d]: %s"), Field, Index, *OutError);
            return false;
        }
        const TSet<FString> Allowed{TEXT("id"), TEXT("file")};
        if (!ValidateUnused(*Object, Allowed, FString::Printf(TEXT("%s[%d]"), Field, Index), OutError))
        {
            return false;
        }
    }
    return true;
}

bool FImg2UmgImporter::CreateEntry(const FAssetSpec& Spec, FString& OutError)
{
    TSharedPtr<FJsonObject> Document;
    if (!ReadJsonFile(FPaths::Combine(ManifestDirectory, Spec.File), Document, OutError)) return false;
    FString Format;
    if (!Img2Umg::RequiredString(Document, TEXT("format"), Format, OutError) || Format != TEXT("img2umg-entry"))
    {
        OutError = TEXT("Entry document must use format 'img2umg-entry'.");
        return false;
    }
    FString DocumentId;
    if (!Img2Umg::RequiredString(Document, TEXT("id"), DocumentId, OutError) || DocumentId != Spec.Id)
    {
        OutError = FString::Printf(TEXT("Entry document id must match manifest id '%s'."), *Spec.Id);
        return false;
    }
    UWidgetBlueprint* Blueprint = nullptr;
    if (!CreateWidgetBlueprint(Spec.Id, Document, true, Blueprint, OutError)) return false;
    EntryBlueprints.Add(Spec.Id, Blueprint);
    return true;
}

bool FImg2UmgImporter::CreateScreen(const FAssetSpec& Spec, FString& OutError)
{
    TSharedPtr<FJsonObject> Document;
    if (!ReadJsonFile(FPaths::Combine(ManifestDirectory, Spec.File), Document, OutError)) return false;
    FString Format;
    if (!Img2Umg::RequiredString(Document, TEXT("format"), Format, OutError) || Format != TEXT("img2umg-screen"))
    {
        OutError = TEXT("Screen document must use format 'img2umg-screen'.");
        return false;
    }
    FString DocumentId;
    if (!Img2Umg::RequiredString(Document, TEXT("id"), DocumentId, OutError) || DocumentId != Spec.Id)
    {
        OutError = FString::Printf(TEXT("Screen document id must match its manifest id."));
        return false;
    }
    UWidgetBlueprint* Blueprint = nullptr;
    return CreateWidgetBlueprint(Spec.Id, Document, false, Blueprint, OutError);
}

bool FImg2UmgImporter::CreateWidgetBlueprint(const FString& Id, const TSharedPtr<FJsonObject>& Document, bool bEntry, UWidgetBlueprint*& OutBlueprint, FString& OutError)
{
    double VersionNumber = 0.0;
    if (!Document->TryGetNumberField(TEXT("version"), VersionNumber) || VersionNumber != 1.0)
    {
        OutError = TEXT("Unsupported or missing document version. This plugin supports version 1.");
        return false;
    }
    const TSharedPtr<FJsonObject>* Root = nullptr;
    if (!Document->TryGetObjectField(TEXT("root"), Root) || !Root || !Root->IsValid())
    {
        OutError = TEXT("Document must contain a 'root' widget object.");
        return false;
    }

    TSet<FString> DocumentFields{TEXT("format"), TEXT("version"), TEXT("id"), TEXT("root")};
    if (bEntry) DocumentFields.Add(TEXT("size")); else DocumentFields.Add(TEXT("canvas"));
    if (!ValidateUnused(Document, DocumentFields, bEntry ? TEXT("entry document") : TEXT("screen document"), OutError)) return false;
    if (bEntry)
    {
        TArray<double> Size;
        if (!Img2Umg::NumberArray(Document, TEXT("size"), 2, Size, OutError) || Size[0] <= 0.0 || Size[1] <= 0.0)
        {
            if (OutError.IsEmpty()) OutError = TEXT("Entry size values must be positive.");
            return false;
        }
    }
    else
    {
        const TSharedPtr<FJsonObject>* Canvas = nullptr;
        if (!Document->TryGetObjectField(TEXT("canvas"), Canvas) || !Canvas || !Canvas->IsValid())
        {
            OutError = TEXT("Screen must contain canvas { width, height }.");
            return false;
        }
        double Width = 0.0;
        double Height = 0.0;
        if (!(*Canvas)->TryGetNumberField(TEXT("width"), Width) || !(*Canvas)->TryGetNumberField(TEXT("height"), Height) || Width <= 0.0 || Height <= 0.0)
        {
            OutError = TEXT("Canvas width and height must be positive numbers.");
            return false;
        }
        const TSet<FString> CanvasFields{TEXT("width"), TEXT("height")};
        if (!ValidateUnused(*Canvas, CanvasFields, TEXT("screen canvas"), OutError)) return false;
    }

    const FString SafeName = ObjectTools::SanitizeObjectName(FString::Printf(TEXT("WBP_%s"), *Id));
    const FString PackageName = OutputPath / SafeName;
    const FString ObjectPath = PackageName + TEXT(".") + SafeName;
    OutBlueprint = LoadObject<UWidgetBlueprint>(nullptr, *ObjectPath);
    if (!OutBlueprint)
    {
        UPackage* Package = CreatePackage(*PackageName);
        UWidgetBlueprintFactory* Factory = NewObject<UWidgetBlueprintFactory>();
        Factory->ParentClass = UUserWidget::StaticClass();
        OutBlueprint = Cast<UWidgetBlueprint>(Factory->FactoryCreateNew(
            UWidgetBlueprint::StaticClass(), Package, *SafeName, RF_Public | RF_Standalone | RF_Transactional, nullptr, GWarn));
        if (!OutBlueprint)
        {
            OutError = FString::Printf(TEXT("Could not create Widget Blueprint %s."), *ObjectPath);
            return false;
        }
        FAssetRegistryModule::AssetCreated(OutBlueprint);
    }

    OutBlueprint->Modify();
    OutBlueprint->WidgetTree = NewObject<UWidgetTree>(OutBlueprint, TEXT("WidgetTree"), RF_Transactional);
    UWidget* RootWidget = nullptr;
    if (!BuildWidget(OutBlueprint, OutBlueprint->WidgetTree, *Root, nullptr, RootWidget, OutError)) return false;
    OutBlueprint->WidgetTree->RootWidget = RootWidget;

    if (bEntry && !AddEntryInterface(OutBlueprint, OutError)) return false;
    if (!SaveAndCompile(OutBlueprint, OutError)) return false;
    return true;
}

bool FImg2UmgImporter::BuildWidget(UWidgetBlueprint* Blueprint, UWidgetTree* Tree, const TSharedPtr<FJsonObject>& Node, UPanelWidget* Parent, UWidget*& OutWidget, FString& OutError)
{
    FString Id;
    FString Type;
    if (!Img2Umg::RequiredString(Node, TEXT("id"), Id, OutError) || !Img2Umg::RequiredString(Node, TEXT("type"), Type, OutError)) return false;
    if (Tree->FindWidget(FName(*Id)))
    {
        OutError = FString::Printf(TEXT("Duplicate widget id '%s'."), *Id);
        return false;
    }

    static const TMap<FString, UClass*> Types = {
        {TEXT("Canvas"), UCanvasPanel::StaticClass()},
        {TEXT("Overlay"), UOverlay::StaticClass()}, {TEXT("HorizontalBox"), UHorizontalBox::StaticClass()},
        {TEXT("VerticalBox"), UVerticalBox::StaticClass()}, {TEXT("SizeBox"), USizeBox::StaticClass()},
        {TEXT("ScaleBox"), UScaleBox::StaticClass()}, {TEXT("Border"), UBorder::StaticClass()},
        {TEXT("Image"), UImage::StaticClass()}, {TEXT("Text"), UTextBlock::StaticClass()},
        {TEXT("Button"), UButton::StaticClass()}, {TEXT("ProgressBar"), UProgressBar::StaticClass()},
        {TEXT("Spacer"), USpacer::StaticClass()}, {TEXT("ListView"), UListView::StaticClass()},
        {TEXT("TileView"), UTileView::StaticClass()}
    };
    UClass* const* WidgetClass = Types.Find(Type);
    if (!WidgetClass)
    {
        OutError = FString::Printf(TEXT("Widget '%s' has unsupported type '%s'."), *Id, *Type);
        return false;
    }
    OutWidget = Tree->ConstructWidget<UWidget>(*WidgetClass, FName(*Id));
    if (!OutWidget)
    {
        OutError = FString::Printf(TEXT("Could not construct widget '%s'."), *Id);
        return false;
    }

    if (Parent)
    {
        if (!Parent->AddChild(OutWidget))
        {
            OutError = FString::Printf(TEXT("Parent '%s' rejected child '%s'. It may accept only one child."), *Parent->GetName(), *Id);
            return false;
        }
    }

    TSharedPtr<FJsonObject> Props = MakeShared<FJsonObject>();
    const TSharedPtr<FJsonObject>* PropsPtr = nullptr;
    if (Node->TryGetObjectField(TEXT("props"), PropsPtr) && PropsPtr && PropsPtr->IsValid()) Props = *PropsPtr;
    TSet<FString> Used;
    if (!ApplyCommonProperties(OutWidget, Props, Used, OutError) || !ApplyWidgetProperties(OutWidget, Type, Props, Used, OutError))
    {
        OutError = FString::Printf(TEXT("Widget '%s': %s"), *Id, *OutError);
        return false;
    }
    if (UButton* Button = Cast<UButton>(OutWidget))
    {
        FString Label;
        const bool HasLabel = Props->TryGetStringField(TEXT("label"), Label);
        if (HasLabel)
        {
            Used.Add(TEXT("label"));
            const TArray<TSharedPtr<FJsonValue>>* DeclaredChildren = nullptr;
            if (Node->TryGetArrayField(TEXT("children"), DeclaredChildren) && DeclaredChildren && !DeclaredChildren->IsEmpty())
            {
                OutError = FString::Printf(TEXT("Button '%s' cannot use both props.label and explicit children."), *Id);
                return false;
            }
            UTextBlock* LabelWidget = Tree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), FName(*(Id + TEXT("__Label"))));
            LabelWidget->SetText(FText::FromString(Label));
            FLinearColor TextColor;
            bool Found = false;
            if (!Img2Umg::OptionalColor(Props, TEXT("textColor"), TextColor, Found, OutError)) return false;
            if (Found) { Used.Add(TEXT("textColor")); LabelWidget->SetColorAndOpacity(FSlateColor(TextColor)); }
            double FontSize = 0.0;
            if (Props->TryGetNumberField(TEXT("fontSize"), FontSize))
            {
                Used.Add(TEXT("fontSize"));
                FSlateFontInfo Font = LabelWidget->GetFont();
                Font.Size = FMath::RoundToInt(FontSize);
                LabelWidget->SetFont(Font);
            }
            Button->AddChild(LabelWidget);
        }
        else if (Props->HasField(TEXT("textColor")) || Props->HasField(TEXT("fontSize")))
        {
            OutError = FString::Printf(TEXT("Button '%s' needs props.label when textColor or fontSize is present."), *Id);
            return false;
        }
    }
    if (!ValidateUnused(Props, Used, FString::Printf(TEXT("props of widget '%s'"), *Id), OutError)) return false;

    const TSharedPtr<FJsonObject>* Slot = nullptr;
    if (Node->TryGetObjectField(TEXT("slot"), Slot) && Slot && Slot->IsValid())
    {
        if (!Parent)
        {
            OutError = FString::Printf(TEXT("Root widget '%s' cannot have slot properties."), *Id);
            return false;
        }
        if (!ApplySlotProperties(OutWidget, Parent, *Slot, OutError))
        {
            OutError = FString::Printf(TEXT("Slot of widget '%s': %s"), *Id, *OutError);
            return false;
        }
    }

    const TArray<TSharedPtr<FJsonValue>>* Children = nullptr;
    if (Node->TryGetArrayField(TEXT("children"), Children) && Children)
    {
        UPanelWidget* Panel = Cast<UPanelWidget>(OutWidget);
        if (!Panel && !Children->IsEmpty())
        {
            OutError = FString::Printf(TEXT("Widget '%s' of type '%s' cannot contain children."), *Id, *Type);
            return false;
        }
        for (int32 Index = 0; Index < Children->Num(); ++Index)
        {
            const TSharedPtr<FJsonObject>* ChildObject = nullptr;
            if (!(*Children)[Index]->TryGetObject(ChildObject) || !ChildObject || !ChildObject->IsValid())
            {
                OutError = FString::Printf(TEXT("children[%d] of widget '%s' must be an object."), Index, *Id);
                return false;
            }
            UWidget* Child = nullptr;
            if (!BuildWidget(Blueprint, Tree, *ChildObject, Panel, Child, OutError)) return false;
        }
    }

    const TSet<FString> NodeFields{TEXT("id"), TEXT("type"), TEXT("props"), TEXT("slot"), TEXT("children")};
    return ValidateUnused(Node, NodeFields, FString::Printf(TEXT("widget '%s'"), *Id), OutError);
}

bool FImg2UmgImporter::ApplyCommonProperties(UWidget* Widget, const TSharedPtr<FJsonObject>& Props, TSet<FString>& Used, FString& OutError)
{
    return true;
}

bool FImg2UmgImporter::ApplyWidgetProperties(UWidget* Widget, const FString& Type, const TSharedPtr<FJsonObject>& Props, TSet<FString>& Used, FString& OutError)
{
    double Number = 0.0;
    bool Boolean = false;
    FString String;
    FLinearColor Color;
    bool Found = false;

    if (USizeBox* SizeBox = Cast<USizeBox>(Widget))
    {
        if (Props->TryGetNumberField(TEXT("widthOverride"), Number)) { Used.Add(TEXT("widthOverride")); SizeBox->SetWidthOverride(Number); }
        if (Props->TryGetNumberField(TEXT("heightOverride"), Number)) { Used.Add(TEXT("heightOverride")); SizeBox->SetHeightOverride(Number); }
        if (Props->TryGetNumberField(TEXT("minWidth"), Number)) { Used.Add(TEXT("minWidth")); SizeBox->SetMinDesiredWidth(Number); }
        if (Props->TryGetNumberField(TEXT("minHeight"), Number)) { Used.Add(TEXT("minHeight")); SizeBox->SetMinDesiredHeight(Number); }
    }
    else if (UScaleBox* ScaleBox = Cast<UScaleBox>(Widget))
    {
        if (Props->TryGetStringField(TEXT("stretch"), String))
        {
            Used.Add(TEXT("stretch"));
            if (String == TEXT("none")) ScaleBox->SetStretch(EStretch::None);
            else if (String == TEXT("fill")) ScaleBox->SetStretch(EStretch::Fill);
            else if (String == TEXT("scaleToFit")) ScaleBox->SetStretch(EStretch::ScaleToFit);
            else if (String == TEXT("scaleToFill")) ScaleBox->SetStretch(EStretch::ScaleToFill);
            else if (String == TEXT("scaleToFitX")) ScaleBox->SetStretch(EStretch::ScaleToFitX);
            else if (String == TEXT("scaleToFitY")) ScaleBox->SetStretch(EStretch::ScaleToFitY);
            else { OutError = FString::Printf(TEXT("Unknown stretch '%s'."), *String); return false; }
        }
    }
    else if (UBorder* Border = Cast<UBorder>(Widget))
    {
        if (!Img2Umg::OptionalColor(Props, TEXT("backgroundColor"), Color, Found, OutError)) return false;
        if (Found) { Used.Add(TEXT("backgroundColor")); Border->SetBrushColor(Color); }
        const TSharedPtr<FJsonValue> PaddingValue = Props->TryGetField(TEXT("padding"));
        if (PaddingValue.IsValid()) { Used.Add(TEXT("padding")); FMargin Padding; if (!Img2Umg::Margin(PaddingValue, Padding, OutError)) return false; Border->SetPadding(Padding); }
        FLinearColor BorderColor;
        bool HasBorderColor = false;
        if (!Img2Umg::OptionalColor(Props, TEXT("borderColor"), BorderColor, HasBorderColor, OutError)) return false;
        double BorderWidth = 0.0;
        const bool HasBorderWidth = Props->TryGetNumberField(TEXT("borderWidth"), BorderWidth);
        if (HasBorderColor || HasBorderWidth)
        {
            if (!HasBorderColor || !HasBorderWidth || BorderWidth < 0.0) { OutError = TEXT("Border stroke requires both borderColor and a non-negative borderWidth."); return false; }
            Used.Add(TEXT("borderColor")); Used.Add(TEXT("borderWidth"));
            FSlateBrush Brush;
            Brush.DrawAs = ESlateBrushDrawType::RoundedBox;
            Brush.TintColor = FSlateColor(Found ? Color : FLinearColor::White);
            Brush.OutlineSettings.Color = BorderColor;
            Brush.OutlineSettings.Width = BorderWidth;
            Border->SetBrushColor(FLinearColor::White);
            Border->SetBrush(Brush);
        }
    }
    else if (UImage* Image = Cast<UImage>(Widget))
    {
        bool bHasTexture = false;
        if (Props->HasField(TEXT("source")))
        {
            Used.Add(TEXT("source"));
            const TSharedPtr<FJsonValue> SourceValue = Props->TryGetField(TEXT("source"));
            if (SourceValue.IsValid() && SourceValue->Type != EJson::Null)
            {
                if (!SourceValue->TryGetString(String) || String.IsEmpty()) { OutError = TEXT("'source' must be null or a non-empty Unreal texture asset path."); return false; }
                UTexture2D* Texture = LoadObject<UTexture2D>(nullptr, *String);
                if (!Texture) { OutError = FString::Printf(TEXT("Texture asset '%s' was not found. Use an Unreal asset path or null."), *String); return false; }
                Image->SetBrushFromTexture(Texture, false);
                bHasTexture = true;
            }
        }
        if (!Img2Umg::OptionalColor(Props, TEXT("tint"), Color, Found, OutError)) return false;
        if (Found) { Used.Add(TEXT("tint")); Image->SetColorAndOpacity(Color); }
        if (!Img2Umg::OptionalColor(Props, TEXT("placeholderColor"), Color, Found, OutError)) return false;
        if (Found && !bHasTexture) { Used.Add(TEXT("placeholderColor")); Image->SetColorAndOpacity(Color); }
        else if (Found) Used.Add(TEXT("placeholderColor"));
        if (Props->HasField(TEXT("placeholderLabel"))) { Used.Add(TEXT("placeholderLabel")); }
        if (Props->TryGetStringField(TEXT("drawAs"), String))
        {
            Used.Add(TEXT("drawAs"));
            FSlateBrush Brush = Image->GetBrush();
            if (String == TEXT("image")) Brush.DrawAs = ESlateBrushDrawType::Image;
            else if (String == TEXT("box")) Brush.DrawAs = ESlateBrushDrawType::Box;
            else if (String == TEXT("border")) Brush.DrawAs = ESlateBrushDrawType::Border;
            else { OutError = FString::Printf(TEXT("Unknown drawAs '%s'."), *String); return false; }
            Image->SetBrush(Brush);
        }
        const TSharedPtr<FJsonValue> MarginValue = Props->TryGetField(TEXT("margin"));
        if (MarginValue.IsValid())
        {
            Used.Add(TEXT("margin"));
            FMargin BrushMargin;
            if (!Img2Umg::Margin(MarginValue, BrushMargin, OutError)) return false;
            FSlateBrush Brush = Image->GetBrush(); Brush.Margin = BrushMargin; Image->SetBrush(Brush);
        }
    }
    else if (UTextBlock* Text = Cast<UTextBlock>(Widget))
    {
        if (Props->TryGetStringField(TEXT("text"), String)) { Used.Add(TEXT("text")); Text->SetText(FText::FromString(String)); }
        if (Props->TryGetNumberField(TEXT("fontSize"), Number)) { Used.Add(TEXT("fontSize")); FSlateFontInfo Font = Text->GetFont(); Font.Size = FMath::RoundToInt(Number); Text->SetFont(Font); }
        if (!Img2Umg::OptionalColor(Props, TEXT("color"), Color, Found, OutError)) return false;
        if (Found) { Used.Add(TEXT("color")); Text->SetColorAndOpacity(FSlateColor(Color)); }
        if (Props->TryGetBoolField(TEXT("wrap"), Boolean)) { Used.Add(TEXT("wrap")); Text->SetAutoWrapText(Boolean); }
        if (Props->TryGetStringField(TEXT("horizontalAlign"), String))
        {
            Used.Add(TEXT("horizontalAlign"));
            if (String == TEXT("left")) Text->SetJustification(ETextJustify::Left);
            else if (String == TEXT("center")) Text->SetJustification(ETextJustify::Center);
            else if (String == TEXT("right")) Text->SetJustification(ETextJustify::Right);
            else { OutError = FString::Printf(TEXT("Unknown horizontalAlign '%s'."), *String); return false; }
        }
        if (Props->TryGetStringField(TEXT("verticalAlign"), String))
        {
            Used.Add(TEXT("verticalAlign"));
            if (String != TEXT("top") && String != TEXT("center") && String != TEXT("bottom")) { OutError = FString::Printf(TEXT("Unknown verticalAlign '%s'."), *String); return false; }
        }
    }
    else if (UButton* Button = Cast<UButton>(Widget))
    {
        if (!Img2Umg::OptionalColor(Props, TEXT("backgroundColor"), Color, Found, OutError)) return false;
        if (Found) { Used.Add(TEXT("backgroundColor")); Button->SetBackgroundColor(Color); }
    }
    else if (UProgressBar* Progress = Cast<UProgressBar>(Widget))
    {
        if (Props->TryGetNumberField(TEXT("percent"), Number)) { Used.Add(TEXT("percent")); if (Number < 0.0 || Number > 1.0) { OutError = TEXT("Progress percent must be between 0 and 1."); return false; } Progress->SetPercent(Number); }
        if (!Img2Umg::OptionalColor(Props, TEXT("fillColor"), Color, Found, OutError)) return false;
        if (Found) { Used.Add(TEXT("fillColor")); Progress->SetFillColorAndOpacity(Color); }
        if (!Img2Umg::OptionalColor(Props, TEXT("backgroundColor"), Color, Found, OutError)) return false;
        if (Found)
        {
            Used.Add(TEXT("backgroundColor"));
            FProgressBarStyle Style = Progress->GetWidgetStyle();
            Style.BackgroundImage.TintColor = FSlateColor(Color);
            Progress->SetWidgetStyle(Style);
        }
    }
    else if (USpacer* Spacer = Cast<USpacer>(Widget))
    {
        if (Props->HasField(TEXT("size"))) { Used.Add(TEXT("size")); TArray<double> N; if (!Img2Umg::NumberArray(Props, TEXT("size"), 2, N, OutError)) return false; Spacer->SetSize(FVector2D(N[0], N[1])); }
    }
    else if (UListViewBase* List = Cast<UListViewBase>(Widget))
    {
        if (!Props->TryGetStringField(TEXT("entryTemplate"), String) || String.IsEmpty()) { OutError = TEXT("ListView and TileView require 'entryTemplate'."); return false; }
        Used.Add(TEXT("entryTemplate"));
        const FString EntryTemplateId = String;
        UClass* EntryClass = nullptr;
        if (!ResolveEntryClass(EntryTemplateId, EntryClass, OutError)) return false;
        if (!Img2Umg::SetObjectProperty(List, TEXT("EntryWidgetClass"), EntryClass, OutError)) return false;

        int32 PreviewCount = 0;
        if (!Props->TryGetStringField(TEXT("preview"), String) || String.IsEmpty()) { OutError = TEXT("ListView and TileView require 'preview'."); return false; }
        Used.Add(TEXT("preview")); PreviewCount = ReadPreviewCount(String, EntryTemplateId, OutError); if (PreviewCount < 0) return false;
        if (!Img2Umg::SetIntProperty(List, TEXT("NumDesignerPreviewEntries"), FMath::Min(PreviewCount, 20), OutError)) return false;

        if (Props->TryGetStringField(TEXT("orientation"), String))
        {
            Used.Add(TEXT("orientation"));
            if (String == TEXT("vertical")) { if (!Img2Umg::SetByteProperty(List, TEXT("Orientation"), Orient_Vertical, OutError)) return false; }
            else if (String == TEXT("horizontal")) { if (!Img2Umg::SetByteProperty(List, TEXT("Orientation"), Orient_Horizontal, OutError)) return false; }
            else { OutError = FString::Printf(TEXT("Unknown orientation '%s'."), *String); return false; }
        }
        if (!Props->HasField(TEXT("entrySize"))) { OutError = TEXT("ListView and TileView require 'entrySize'."); return false; }
        {
            Used.Add(TEXT("entrySize"));
            TArray<double> N; if (!Img2Umg::NumberArray(Props, TEXT("entrySize"), 2, N, OutError)) return false;
            if (UTileView* Tile = Cast<UTileView>(List)) { Tile->SetEntryWidth(N[0]); Tile->SetEntryHeight(N[1]); }
        }
        if (!Props->HasField(TEXT("spacing"))) { OutError = TEXT("ListView and TileView require 'spacing'."); return false; }
        {
            Used.Add(TEXT("spacing"));
            TArray<double> N; if (!Img2Umg::NumberArray(Props, TEXT("spacing"), 2, N, OutError)) return false;
            if (N[0] < 0.0 || N[1] < 0.0) { OutError = TEXT("List spacing cannot be negative."); return false; }
            if (UListView* ConcreteList = Cast<UListView>(List))
            {
                ConcreteList->SetHorizontalEntrySpacing(N[0]);
                ConcreteList->SetVerticalEntrySpacing(N[1]);
            }
        }
        if (Props->TryGetNumberField(TEXT("columns"), Number))
        {
            Used.Add(TEXT("columns"));
            if (!Cast<UTileView>(List) || Number < 1.0 || !FMath::IsNearlyEqual(Number, static_cast<double>(FMath::RoundToInt(Number))))
            {
                OutError = TEXT("'columns' is valid only for TileView and must be a positive integer.");
                return false;
            }
        }
    }
    return true;
}

bool FImg2UmgImporter::ApplySlotProperties(UWidget* Widget, UPanelWidget* Parent, const TSharedPtr<FJsonObject>& Slot, FString& OutError)
{
    TSet<FString> Used;
    double Number = 0.0;
    bool Boolean = false;
    FString String;

    if (UCanvasPanelSlot* Canvas = Cast<UCanvasPanelSlot>(Widget->Slot))
    {
        if (!Slot->HasField(TEXT("position")) || !Slot->HasField(TEXT("size"))) { OutError = TEXT("Canvas slots require position and size."); return false; }
        if (Slot->HasField(TEXT("position"))) { Used.Add(TEXT("position")); TArray<double> N; if (!Img2Umg::NumberArray(Slot, TEXT("position"), 2, N, OutError)) return false; Canvas->SetPosition(FVector2D(N[0], N[1])); }
        if (Slot->HasField(TEXT("size"))) { Used.Add(TEXT("size")); TArray<double> N; if (!Img2Umg::NumberArray(Slot, TEXT("size"), 2, N, OutError)) return false; if (N[0] <= 0.0 || N[1] <= 0.0) { OutError = TEXT("Canvas slot size values must be positive."); return false; } Canvas->SetSize(FVector2D(N[0], N[1])); }
        if (Slot->HasField(TEXT("anchors"))) { Used.Add(TEXT("anchors")); TArray<double> N; if (!Img2Umg::NumberArray(Slot, TEXT("anchors"), 4, N, OutError)) return false; Canvas->SetAnchors(FAnchors(N[0], N[1], N[2], N[3])); }
        if (Slot->HasField(TEXT("alignment"))) { Used.Add(TEXT("alignment")); TArray<double> N; if (!Img2Umg::NumberArray(Slot, TEXT("alignment"), 2, N, OutError)) return false; Canvas->SetAlignment(FVector2D(N[0], N[1])); }
        if (Slot->TryGetBoolField(TEXT("autoSize"), Boolean)) { Used.Add(TEXT("autoSize")); Canvas->SetAutoSize(Boolean); }
        if (Slot->TryGetNumberField(TEXT("zOrder"), Number)) { Used.Add(TEXT("zOrder")); if (!FMath::IsNearlyEqual(Number, static_cast<double>(FMath::RoundToInt(Number)))) { OutError = TEXT("zOrder must be an integer."); return false; } Canvas->SetZOrder(FMath::RoundToInt(Number)); }
    }
    else
    {
        FMargin Padding;
        const TSharedPtr<FJsonValue> PaddingValue = Slot->TryGetField(TEXT("padding"));
        const bool HasPadding = PaddingValue.IsValid();
        if (HasPadding)
        {
            Used.Add(TEXT("padding"));
            TArray<double> N;
            if (!Img2Umg::NumberArray(Slot, TEXT("padding"), 4, N, OutError)) return false;
            Padding = FMargin(N[0], N[1], N[2], N[3]);
        }

        EHorizontalAlignment HAlign = HAlign_Fill;
        EVerticalAlignment VAlign = VAlign_Fill;
        if (Slot->TryGetStringField(TEXT("horizontalAlign"), String)) { Used.Add(TEXT("horizontalAlign")); bool Valid; HAlign = Img2Umg::HorizontalAlignment(String, Valid); if (!Valid) { OutError = FString::Printf(TEXT("Unknown horizontalAlign '%s'."), *String); return false; } }
        if (Slot->TryGetStringField(TEXT("verticalAlign"), String)) { Used.Add(TEXT("verticalAlign")); bool Valid; VAlign = Img2Umg::VerticalAlignment(String, Valid); if (!Valid) { OutError = FString::Printf(TEXT("Unknown verticalAlign '%s'."), *String); return false; } }

        if (UOverlaySlot* S = Cast<UOverlaySlot>(Widget->Slot)) { if (HasPadding) S->SetPadding(Padding); S->SetHorizontalAlignment(HAlign); S->SetVerticalAlignment(VAlign); }
        else if (UHorizontalBoxSlot* S = Cast<UHorizontalBoxSlot>(Widget->Slot))
        {
            if (HasPadding) S->SetPadding(Padding); S->SetHorizontalAlignment(HAlign); S->SetVerticalAlignment(VAlign);
            if (!Slot->HasField(TEXT("sizeRule"))) { OutError = TEXT("HorizontalBox slots require sizeRule."); return false; }
            if (Slot->TryGetStringField(TEXT("sizeRule"), String))
            {
                Used.Add(TEXT("sizeRule"));
                FSlateChildSize ChildSize;
                if (String == TEXT("auto")) ChildSize.SizeRule = ESlateSizeRule::Automatic;
                else if (String == TEXT("fill")) ChildSize.SizeRule = ESlateSizeRule::Fill;
                else { OutError = TEXT("sizeRule must be 'auto' or 'fill'."); return false; }
                if (Slot->TryGetNumberField(TEXT("fill"), Number))
                {
                    Used.Add(TEXT("fill"));
                    if (String != TEXT("fill") || Number <= 0.0) { OutError = TEXT("'fill' must be positive and requires sizeRule 'fill'."); return false; }
                    ChildSize.Value = Number;
                }
                S->SetSize(ChildSize);
            }
            else if (Slot->HasField(TEXT("fill"))) { OutError = TEXT("'fill' requires sizeRule 'fill'."); return false; }
        }
        else if (UVerticalBoxSlot* S = Cast<UVerticalBoxSlot>(Widget->Slot))
        {
            if (HasPadding) S->SetPadding(Padding); S->SetHorizontalAlignment(HAlign); S->SetVerticalAlignment(VAlign);
            if (!Slot->HasField(TEXT("sizeRule"))) { OutError = TEXT("VerticalBox slots require sizeRule."); return false; }
            if (Slot->TryGetStringField(TEXT("sizeRule"), String))
            {
                Used.Add(TEXT("sizeRule"));
                FSlateChildSize ChildSize;
                if (String == TEXT("auto")) ChildSize.SizeRule = ESlateSizeRule::Automatic;
                else if (String == TEXT("fill")) ChildSize.SizeRule = ESlateSizeRule::Fill;
                else { OutError = TEXT("sizeRule must be 'auto' or 'fill'."); return false; }
                if (Slot->TryGetNumberField(TEXT("fill"), Number))
                {
                    Used.Add(TEXT("fill"));
                    if (String != TEXT("fill") || Number <= 0.0) { OutError = TEXT("'fill' must be positive and requires sizeRule 'fill'."); return false; }
                    ChildSize.Value = Number;
                }
                S->SetSize(ChildSize);
            }
            else if (Slot->HasField(TEXT("fill"))) { OutError = TEXT("'fill' requires sizeRule 'fill'."); return false; }
        }
        else if (UBorderSlot* S = Cast<UBorderSlot>(Widget->Slot)) { if (HasPadding) S->SetPadding(Padding); S->SetHorizontalAlignment(HAlign); S->SetVerticalAlignment(VAlign); }
        else if (UButtonSlot* S = Cast<UButtonSlot>(Widget->Slot)) { if (HasPadding) S->SetPadding(Padding); S->SetHorizontalAlignment(HAlign); S->SetVerticalAlignment(VAlign); }
        else if (USizeBoxSlot* S = Cast<USizeBoxSlot>(Widget->Slot)) { if (HasPadding) S->SetPadding(Padding); S->SetHorizontalAlignment(HAlign); S->SetVerticalAlignment(VAlign); }
        else if (UScaleBoxSlot* S = Cast<UScaleBoxSlot>(Widget->Slot)) { if (HasPadding) S->SetPadding(Padding); S->SetHorizontalAlignment(HAlign); S->SetVerticalAlignment(VAlign); }
        else { OutError = FString::Printf(TEXT("Unsupported slot type under parent '%s'."), *Parent->GetClass()->GetName()); return false; }
    }
    return ValidateUnused(Slot, Used, TEXT("slot"), OutError);
}

bool FImg2UmgImporter::ValidateUnused(const TSharedPtr<FJsonObject>& Object, const TSet<FString>& Used, const FString& Context, FString& OutError) const
{
    for (const TPair<FString, TSharedPtr<FJsonValue>>& Field : Object->Values)
    {
        if (!Used.Contains(Field.Key))
        {
            OutError = FString::Printf(TEXT("Unknown field '%s' in %s."), *Field.Key, *Context);
            return false;
        }
    }
    return true;
}

bool FImg2UmgImporter::SaveAndCompile(UWidgetBlueprint* Blueprint, FString& OutError) const
{
    FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint);
    FKismetEditorUtilities::CompileBlueprint(Blueprint);
    if (Blueprint->Status == BS_Error || !Blueprint->GeneratedClass)
    {
        OutError = TEXT("Unreal failed to compile the generated Widget Blueprint. Check the Blueprint compiler log.");
        return false;
    }
    Blueprint->MarkPackageDirty();
    const FString PackageName = Blueprint->GetOutermost()->GetName();
    const FString Filename = FPackageName::LongPackageNameToFilename(PackageName, FPackageName::GetAssetPackageExtension());
    FSavePackageArgs SaveArgs;
    SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
    SaveArgs.SaveFlags = SAVE_NoError;
    if (!UPackage::SavePackage(Blueprint->GetOutermost(), Blueprint, *Filename, SaveArgs))
    {
        OutError = FString::Printf(TEXT("Could not save '%s'."), *Filename);
        return false;
    }
    return true;
}

bool FImg2UmgImporter::AddEntryInterface(UWidgetBlueprint* Blueprint, FString& OutError) const
{
    const UClass* InterfaceClass = UUserObjectListEntry::StaticClass();
    for (const FBPInterfaceDescription& Existing : Blueprint->ImplementedInterfaces)
    {
        if (Existing.Interface == InterfaceClass) return true;
    }
    if (!FBlueprintEditorUtils::ImplementNewInterface(Blueprint, InterfaceClass->GetClassPathName()))
    {
        OutError = TEXT("Could not add IUserObjectListEntry to entry Widget Blueprint.");
        return false;
    }
    return true;
}

bool FImg2UmgImporter::ResolveEntryClass(const FString& Id, UClass*& OutClass, FString& OutError) const
{
    UWidgetBlueprint* const* Blueprint = EntryBlueprints.Find(Id);
    if (!Blueprint || !*Blueprint || !(*Blueprint)->GeneratedClass)
    {
        OutError = FString::Printf(TEXT("entryTemplate '%s' does not reference an entry declared earlier in the manifest."), *Id);
        return false;
    }
    OutClass = (*Blueprint)->GeneratedClass;
    return true;
}

int32 FImg2UmgImporter::ReadPreviewCount(const FString& PreviewId, const FString& ExpectedEntryId, FString& OutError) const
{
    const FString* RelativeFilename = PreviewFiles.Find(PreviewId);
    if (!RelativeFilename)
    {
        OutError = FString::Printf(TEXT("preview '%s' is not declared in the manifest."), *PreviewId);
        return -1;
    }
    TSharedPtr<FJsonObject> Preview;
    if (!ReadJsonFile(FPaths::Combine(ManifestDirectory, *RelativeFilename), Preview, OutError)) return -1;
    FString Format;
    if (!Img2Umg::RequiredString(Preview, TEXT("format"), Format, OutError) || Format != TEXT("img2umg-preview"))
    {
        OutError = FString::Printf(TEXT("Preview '%s' must use format 'img2umg-preview'."), *PreviewId);
        return -1;
    }
    double VersionNumber = 0.0;
    if (!Preview->TryGetNumberField(TEXT("version"), VersionNumber) || VersionNumber != 1.0)
    {
        OutError = FString::Printf(TEXT("Preview '%s' must use version 1."), *PreviewId);
        return -1;
    }
    FString EntryTemplate;
    if (!Img2Umg::RequiredString(Preview, TEXT("entryTemplate"), EntryTemplate, OutError) || EntryTemplate != ExpectedEntryId)
    {
        OutError = FString::Printf(TEXT("Preview '%s' must reference entryTemplate '%s'."), *PreviewId, *ExpectedEntryId);
        return -1;
    }
    const TArray<TSharedPtr<FJsonValue>>* Items = nullptr;
    if (!Preview->TryGetArrayField(TEXT("items"), Items) || !Items)
    {
        OutError = FString::Printf(TEXT("Preview '%s' must contain an items array."), *PreviewId);
        return -1;
    }
    for (int32 ItemIndex = 0; ItemIndex < Items->Num(); ++ItemIndex)
    {
        const TSharedPtr<FJsonObject>* Item = nullptr;
        if (!(*Items)[ItemIndex]->TryGetObject(Item) || !Item || !Item->IsValid())
        {
            OutError = FString::Printf(TEXT("Preview '%s' items[%d] must be an object."), *PreviewId, ItemIndex);
            return -1;
        }
        const TSet<FString> ItemFields{TEXT("overrides")};
        if (!ValidateUnused(*Item, ItemFields, FString::Printf(TEXT("preview '%s' item %d"), *PreviewId, ItemIndex), OutError)) return -1;
        const TArray<TSharedPtr<FJsonValue>>* Overrides = nullptr;
        if (!(*Item)->TryGetArrayField(TEXT("overrides"), Overrides) || !Overrides)
        {
            OutError = FString::Printf(TEXT("Preview '%s' items[%d].overrides must be an array."), *PreviewId, ItemIndex);
            return -1;
        }
        for (int32 OverrideIndex = 0; OverrideIndex < Overrides->Num(); ++OverrideIndex)
        {
            const TSharedPtr<FJsonObject>* Override = nullptr;
            if (!(*Overrides)[OverrideIndex]->TryGetObject(Override) || !Override || !Override->IsValid())
            {
                OutError = FString::Printf(TEXT("Preview '%s' override %d must be an object."), *PreviewId, OverrideIndex);
                return -1;
            }
            FString Target;
            const TSharedPtr<FJsonObject>* OverrideProps = nullptr;
            if (!Img2Umg::RequiredString(*Override, TEXT("target"), Target, OutError)
                || !(*Override)->TryGetObjectField(TEXT("props"), OverrideProps) || !OverrideProps || !OverrideProps->IsValid())
            {
                OutError = FString::Printf(TEXT("Preview '%s' override %d requires target and props."), *PreviewId, OverrideIndex);
                return -1;
            }
            const TSet<FString> OverrideFields{TEXT("target"), TEXT("props")};
            if (!ValidateUnused(*Override, OverrideFields, FString::Printf(TEXT("preview '%s' override %d"), *PreviewId, OverrideIndex), OutError)) return -1;
        }
    }
    const TSet<FString> Allowed{TEXT("format"), TEXT("version"), TEXT("entryTemplate"), TEXT("items")};
    if (!ValidateUnused(Preview, Allowed, FString::Printf(TEXT("preview '%s'"), *PreviewId), OutError)) return -1;
    return Items->Num();
}
