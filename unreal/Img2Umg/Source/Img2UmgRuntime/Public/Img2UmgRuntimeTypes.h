#pragma once

#include "CoreMinimal.h"
#include "Img2UmgRuntimeTypes.generated.h"

class UTexture2D;

/** Sparse item override. Presence flags distinguish omission from empty text/null image/transparent color.
 * Colors are linear; the editor converts CSS sRGB before serializing these values.
 */
USTRUCT(BlueprintType)
struct IMG2UMGRUNTIME_API FImg2UmgFieldValue
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    bool bHasText = false;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    FText Text;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    bool bHasImage = false;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    TObjectPtr<UTexture2D> Image = nullptr;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    bool bHasBackground = false;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    FLinearColor Background = FLinearColor::Transparent;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    bool bHasColor = false;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    FLinearColor Color = FLinearColor::White;
};

/** One template node can lower to a foreground control plus a separately named background Border. */
USTRUCT(BlueprintType)
struct IMG2UMGRUNTIME_API FImg2UmgFieldBinding
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    FName NodeId;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    FName WidgetName;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    FName BackgroundWidgetName;
    /** Complete baseline: presence flags are ignored here; all applicable value members are restored. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    FImg2UmgFieldValue Defaults;
};

USTRUCT(BlueprintType)
struct IMG2UMGRUNTIME_API FImg2UmgItemRecord
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    FString Key;
    /** Keyed by template node ID, not per-item source ID or widget name. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    TMap<FName, FImg2UmgFieldValue> Overrides;
};

USTRUCT(BlueprintType)
struct IMG2UMGRUNTIME_API FImg2UmgCollectionSample
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    FName ListWidgetName;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Img2Umg")
    TArray<FImg2UmgItemRecord> Items;
};
