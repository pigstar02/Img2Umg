#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "Blueprint/IUserObjectListEntry.h"
#include "Img2UmgRuntimeTypes.h"
#include "Img2UmgEntryWidget.generated.h"

class UImg2UmgItemData;

/** Native adapter only. The importer generates an editable Widget Blueprint tree in a subclass. */
UCLASS(BlueprintType, Blueprintable)
class IMG2UMGRUNTIME_API UImg2UmgEntryWidget : public UUserWidget, public IUserObjectListEntry
{
    GENERATED_BODY()
    friend class FImg2UmgEntryReuseTest;
public:
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    TArray<FImg2UmgFieldBinding> FieldBindings;

    /** Restores every bound value, then applies sparse overrides. Null/foreign items reset to defaults. */
    UFUNCTION(BlueprintCallable, Category = "Img2Umg")
    void ApplyItem(UImg2UmgItemData* ItemData);

    UFUNCTION(BlueprintCallable, Category = "Img2Umg")
    void ResetFields();

protected:
    virtual void NativeOnListItemObjectSet(UObject* ListItemObject) override;
    virtual void NativeOnEntryReleased() override;
};
