#include "Img2UmgV2Importer.h"

#include "Img2UmgEntryWidget.h"
#include "Img2UmgScreenWidget.h"
#include "Img2UmgListView.h"
#include "Img2UmgRuntimeTypes.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/Button.h"
#include "Components/ButtonSlot.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Components/SizeBox.h"
#include "Components/Spacer.h"
#include "Components/Image.h"
#include "Components/TextBlock.h"
#include "Dom/JsonObject.h"
#include "Engine/Font.h"
#include "Engine/FontFace.h"
#include "Engine/Texture2D.h"
#include "Factories/FontFileImportFactory.h"
#include "Factories/TextureFactory.h"
#include "Fonts/CompositeFont.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformFileManager.h"
#include "HAL/PlatformMisc.h"
#include "Internationalization/Regex.h"
#include "IImageWrapper.h"
#include "IImageWrapperModule.h"
#include "Modules/ModuleManager.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "Misc/FileHelper.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/SavePackage.h"
#include "WidgetBlueprint.h"
#include "WidgetBlueprintFactory.h"

namespace Img2UmgV2
{
using FObj = TSharedPtr<FJsonObject>;
using FVal = TSharedPtr<FJsonValue>;
static bool Fail(FString& E, const FString& At, const FString& Why) { E = At + TEXT(": ") + Why; return false; }
static FObj Obj(const FObj& O, const TCHAR* K) { return O->GetObjectField(K); }
static FString Str(const FObj& O, const TCHAR* K) { return O->GetStringField(K); }
static double Num(const FObj& O, const TCHAR* K) { return O->GetNumberField(K); }
static bool Keys(const FObj& O, const FString& Required, const FString& Optional, FString& E, const FString& At)
{
    if (!O) return Fail(E, At, TEXT("expected object"));
    TArray<FString> R, A; Required.ParseIntoArray(R, TEXT("|")); (Required + TEXT("|") + Optional).ParseIntoArray(A, TEXT("|"));
    for (const FString& K : R) if (!O->HasField(K)) return Fail(E, At, TEXT("missing ") + K);
    for (const auto& P : O->Values) if (!A.Contains(P.Key)) return Fail(E, At, TEXT("unknown field ") + P.Key);
    return true;
}
static bool String(const FVal& V, bool Nonempty = true) { return V && V->Type == EJson::String && (!Nonempty || !V->AsString().IsEmpty()); }
static bool Number(const FVal& V, double Min = -MAX_dbl, bool Positive = false)
{
    if (!V || V->Type != EJson::Number) return false;
    const double N = V->AsNumber(); return FMath::IsFinite(N) && N >= Min && (!Positive || N > Min) && FMath::Abs(N) <= 1.e8;
}
static bool OneOf(const FVal& V, const TCHAR* Choices)
{
    if (!String(V)) return false;
    TArray<FString> A; FString(Choices).ParseIntoArray(A, TEXT("|")); return A.Contains(V->AsString());
}
static FObj AsObject(const FVal& V) { return V && V->Type == EJson::Object ? V->AsObject() : nullptr; }
static bool Array(const FVal& V) { return V && V->Type == EJson::Array; }
static FVal Get(const FObj& O, const TCHAR* K) { return O ? O->TryGetField(K) : nullptr; }
static bool Match(const FString& S, const TCHAR* Pattern) { FRegexMatcher M(FRegexPattern(Pattern), S); return M.FindNext(); }
static bool Color(const FString& S, FLinearColor& Out)
{
    if (S == TEXT("transparent")) { Out = FLinearColor::Transparent; return true; }
    if (Match(S, TEXT("^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")))
    {
        FString H = S;
        if (S.Len() == 4 || S.Len() == 5) { H = TEXT("#"); for (int32 I=1; I<S.Len(); ++I) { H.AppendChar(S[I]); H.AppendChar(S[I]); } }
        Out = FLinearColor(FColor::FromHex(H)); return true;
    }
    if (!Match(S, TEXT("^rgba?\\(.*\\)$"))) return false;
    const bool Alpha = S.StartsWith(TEXT("rgba("));
    FString Inner = S.Mid(Alpha ? 5 : 4); Inner.LeftChopInline(1);
    TArray<FString> Parts; Inner.ParseIntoArray(Parts, TEXT(","), false);
    if (Parts.Num() != (Alpha ? 4 : 3)) return false;
    double C[4] = {0,0,0,1};
    for (int32 I=0; I<Parts.Num(); ++I)
    {
        FString P = Parts[I].TrimStartAndEnd(); const bool Percent = P.EndsWith(TEXT("%")); if (Percent) P.LeftChopInline(1);
        if (!Match(P, I == 3 ? TEXT("^(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)$") : TEXT("^[0-9]+(?:\\.[0-9]+)?$"))) return false;
        C[I] = FMath::Clamp(FCString::Atod(*P) / (Percent ? 100.0 : I == 3 ? 1.0 : 255.0), 0.0, 1.0);
    }
    // CSS channels are sRGB; alpha is linear (do not quantize through an 8-bit color).
    auto Linear = [](double V) { return V <= .04045 ? V/12.92 : FMath::Pow((V+.055)/1.055, 2.4); };
    Out = FLinearColor(Linear(C[0]), Linear(C[1]), Linear(C[2]), C[3]); return true;
}
static bool IsColor(const FVal& V) { FLinearColor C; return String(V) && Color(V->AsString(), C); }
static FLinearColor ReadColor(const FObj& O, const TCHAR* K) { FLinearColor C; Color(Str(O,K), C); return C; }
static bool SafePath(const FString& P)
{
    // No URL decoding is necessary: reject percent escapes altogether, a deliberate strict subset.
    if (P.IsEmpty() || P != P.TrimStartAndEnd() || !FPaths::IsRelative(P) || P.StartsWith(TEXT("/"))) return false;
    for (TCHAR C : P) if (C < 32 || C == 127 || C == '\\' || C == ':' || C == '?' || C == '#' || C == '%') return false;
    TArray<FString> Segments; P.ParseIntoArray(Segments, TEXT("/"), false);
    for (const FString& S : Segments) if (S.IsEmpty() || S == TEXT(".") || S == TEXT("..") || S.EndsWith(TEXT(".")) || S.EndsWith(TEXT(" "))) return false;
    return true;
}
static FString FontKey(const FString& Family, int32 Weight) { return FString::FromInt(Family.Len()) + TEXT(":") + Family + TEXT(":") + FString::FromInt(Weight); }
static FMargin Edges(const FObj& B, const TCHAR* K)
{
    const auto& A = B->GetArrayField(K); return FMargin(A[0]->AsNumber(), A[1]->AsNumber(), A[2]->AsNumber(), A[3]->AsNumber());
}
static bool Zero(const FMargin& M) { return M.Left == 0 && M.Top == 0 && M.Right == 0 && M.Bottom == 0; }
static bool Fixed(const FObj& B, const TCHAR* K) { return Get(B,K)->Type == EJson::Number; }

struct FValidator
{
    FString& E;
    TMap<FString, FObj> Assets, RootNodes;
    TMap<FString, TMap<FString, FObj>> Templates;
    TSet<FString> Fonts;
    int32 NodeCount = 0;
    bool Node(const FObj& N, TMap<FString,FObj>& Nodes, const FObj& Parent, bool Template, int32 Depth)
    {
        if (++NodeCount > 10000 || Depth > 128) return Fail(E,TEXT("nodes"),TEXT("limit exceeded (10000 nodes, depth 128)"));
        if (!Keys(N,TEXT("id|kind|layout|box|paint|children"),TEXT("field|text|assetId|collectionId"),E,TEXT("node"))) return false;
        if (!String(Get(N,TEXT("id"))) || !OneOf(Get(N,TEXT("kind")),TEXT("panel|text|image|button|collection")) || !OneOf(Get(N,TEXT("layout")),TEXT("row|column|canvas|leaf")) || !Array(Get(N,TEXT("children")))) return Fail(E,TEXT("node"),TEXT("invalid id/kind/layout/children"));
        const FString Id = Str(N,TEXT("id")), K = Str(N,TEXT("kind")), L = Str(N,TEXT("layout"));
        for (TCHAR C : Id) if (C < 32 || C == 127) return Fail(E,TEXT("node/id"),TEXT("control characters are not allowed in Unreal binding identifiers"));
        if (Id.Len() >= NAME_SIZE || FName(*Id).IsNone()) return Fail(E,Id,TEXT("node id cannot be represented by a non-None Unreal FName"));
        for (auto& Existing:Nodes) if (FName(*Existing.Key)==FName(*Id)) return Fail(E,Id,TEXT("duplicate/case-insensitive Unreal node id collision"));
        Nodes.Add(Id,N);
        if (N->HasField(TEXT("field")) && !String(Get(N,TEXT("field")),false)) return Fail(E,Id,TEXT("field must be string"));
        const FObj B = AsObject(Get(N,TEXT("box"))), P = AsObject(Get(N,TEXT("paint")));
        if (!Keys(B,TEXT("width|height|padding|margin|gap|align|self|position|left|top|zIndex|display|visibility|overflow"),TEXT(""),E,Id+TEXT("/box")) || !Keys(P,TEXT("background|color"),TEXT(""),E,Id+TEXT("/paint"))) return false;
        for (const TCHAR* F : {TEXT("width"),TEXT("height")}) if (!(Number(Get(B,F),0) || OneOf(Get(B,F),TEXT("auto")))) return Fail(E,Id,TEXT("invalid length"));
        for (const TCHAR* F : {TEXT("padding"),TEXT("margin")}) { const FVal V=Get(B,F); if (!Array(V) || V->AsArray().Num()!=4) return Fail(E,Id,TEXT("edges require four numbers")); for (auto X:V->AsArray()) if (!Number(X,0)) return Fail(E,Id,TEXT("invalid edge")); }
        for (const TCHAR* F : {TEXT("gap"),TEXT("left"),TEXT("top"),TEXT("zIndex")}) if (!Number(Get(B,F),0)) return Fail(E,Id,TEXT("invalid box number"));
        if (Num(B,TEXT("zIndex")) != FMath::FloorToDouble(Num(B,TEXT("zIndex")))) return Fail(E,Id,TEXT("zIndex must be integer"));
        if (!OneOf(Get(B,TEXT("align")),TEXT("flex-start|flex-end|center|stretch")) || !OneOf(Get(B,TEXT("self")),TEXT("auto|flex-start|flex-end|center|stretch")) || !OneOf(Get(B,TEXT("position")),TEXT("flow|absolute")) || !OneOf(Get(B,TEXT("display")),TEXT("visible|collapsed")) || !OneOf(Get(B,TEXT("visibility")),TEXT("visible|hidden")) || !OneOf(Get(B,TEXT("overflow")),TEXT("visible|clip")) || !IsColor(Get(P,TEXT("background"))) || !IsColor(Get(P,TEXT("color")))) return Fail(E,Id,TEXT("invalid box enum or CSS color"));
        const auto& Children = N->GetArrayField(TEXT("children"));
        if ((K==TEXT("text") || K==TEXT("image")) && (L!=TEXT("leaf") || !Children.IsEmpty())) return Fail(E,Id,TEXT("text/image requires childless leaf"));
        if (K==TEXT("button") && Children.Num()>1) return Fail(E,Id,TEXT("button has more than one child"));
        if (L==TEXT("leaf") && K!=TEXT("text") && K!=TEXT("image") && !(K==TEXT("button") && Children.IsEmpty())) return Fail(E,Id,TEXT("invalid leaf kind"));
        if (K==TEXT("text"))
        {
            FObj T=AsObject(Get(N,TEXT("text")));
            if (!Keys(T,TEXT("value|family|size|weight|align"),TEXT(""),E,Id+TEXT("/text"))) return false;
            if (!String(Get(T,TEXT("value")),false) || !String(Get(T,TEXT("family"))) || !Number(Get(T,TEXT("size")),0,true) || !Number(Get(T,TEXT("weight")),0) || (Num(T,TEXT("weight"))!=400 && Num(T,TEXT("weight"))!=700) || !OneOf(Get(T,TEXT("align")),TEXT("left|center|right"))) return Fail(E,Id,TEXT("invalid text"));
            if (!Fonts.Contains(FontKey(Str(T,TEXT("family")),int32(Num(T,TEXT("weight")))))) return Fail(E,Id,TEXT("missing font family/weight"));
        }
        else if (N->HasField(TEXT("text"))) return Fail(E,Id,TEXT("only text nodes can carry text"));
        if (K==TEXT("image")) { if (!Image(Get(N,TEXT("assetId")),Id)) return false; }
        else if (N->HasField(TEXT("assetId"))) return Fail(E,Id,TEXT("only image nodes can carry assetId"));
        if (K==TEXT("collection")) { if (Template || !Children.IsEmpty() || !String(Get(N,TEXT("collectionId")))) return Fail(E,Id,TEXT("invalid collection node")); }
        else if (N->HasField(TEXT("collectionId"))) return Fail(E,Id,TEXT("unexpected collectionId"));
        // The IR schema intentionally describes more than the stock-UMG lowering contract.
        const FMargin Padding=Edges(B,TEXT("padding")), Margin=Edges(B,TEXT("margin"));
        const bool CanvasParent=Parent && Str(Parent,TEXT("layout"))==TEXT("canvas");
        if ((Str(B,TEXT("position"))==TEXT("absolute")) != CanvasParent) return Fail(E,Id,TEXT("absolute nodes require direct canvas parent; canvas children must be absolute"));
        if ((!Parent || CanvasParent) && !Zero(Margin)) return Fail(E,Id,TEXT("root/canvas child margins unsupported"));
        if (L==TEXT("canvas") && (!Zero(Padding) || Num(B,TEXT("gap"))!=0)) return Fail(E,Id,TEXT("canvas requires zero padding/gap"));
        if (!CanvasParent && (Num(B,TEXT("left"))!=0 || Num(B,TEXT("top"))!=0 || Num(B,TEXT("zIndex"))!=0)) return Fail(E,Id,TEXT("offset/zIndex requires canvas parent"));
        if ((CanvasParent || K==TEXT("image")) && (!Fixed(B,TEXT("width")) || !Fixed(B,TEXT("height")))) return Fail(E,Id,TEXT("canvas children/images require fixed width and height"));
        if ((Fixed(B,TEXT("width")) && Num(B,TEXT("width"))<Padding.Left+Padding.Right) || (Fixed(B,TEXT("height")) && Num(B,TEXT("height"))<Padding.Top+Padding.Bottom)) return Fail(E,Id,TEXT("fixed dimensions must contain padding"));
        if (Parent && Str(Obj(Parent,TEXT("box")),TEXT("visibility"))==TEXT("hidden") && Str(B,TEXT("visibility"))!=TEXT("hidden"))
            return Fail(E,Id,TEXT("visible descendants of hidden parents are not supported by UMG"));
        if (Parent && !CanvasParent)
        {
            FObj PB=Obj(Parent,TEXT("box")); bool Row=Str(Parent,TEXT("layout"))==TEXT("row");
            FString Align=Str(B,TEXT("self")); if (Align==TEXT("auto")) Align=Str(PB,TEXT("align"));
            const TCHAR* Axis=Row?TEXT("height"):TEXT("width"); const FMargin PP=Edges(PB,TEXT("padding"));
            double Before=Row?Margin.Top:Margin.Left, After=Row?Margin.Bottom:Margin.Right;
            if (Align==TEXT("center") && Before!=After) return Fail(E,Id,TEXT("asymmetric centered margin is unsupported"));
            if (Str(B,TEXT("display"))!=TEXT("collapsed") && Fixed(PB,Axis) && Fixed(B,Axis) && Num(B,Axis)+Before+After > Num(PB,Axis)-(Row?PP.Top+PP.Bottom:PP.Left+PP.Right)+.01) return Fail(E,Id,TEXT("fixed cross-axis size would be clamped by stock Box"));
        }
        for (const FVal& C:Children) if (!Node(AsObject(C),Nodes,N,Template,Depth+1)) return false;
        return true;
    }
    bool Image(const FVal& V,const FString& At) { return String(V) && Assets.Contains(V->AsString()) && Str(Assets[V->AsString()],TEXT("kind"))==TEXT("image") ? true : Fail(E,At,TEXT("image reference must name an image asset")); }
    bool Run(const FObj& D)
    {
        if (!Keys(D,TEXT("format|version|target|viewport|root|templates|collections|assets|fonts|observations"),TEXT(""),E,TEXT("document"))) return false;
        if (!OneOf(Get(D,TEXT("format")),TEXT("html-umg-ir")) || !Number(Get(D,TEXT("version"))) || Num(D,TEXT("version"))!=2 || !OneOf(Get(D,TEXT("target")),TEXT("ue-5.8.2"))) return Fail(E,TEXT("document"),TEXT("expected html-umg-ir version 2 target ue-5.8.2"));
        FObj V=AsObject(Get(D,TEXT("viewport"))); if (!Keys(V,TEXT("width|height"),TEXT(""),E,TEXT("viewport")) || !Number(Get(V,TEXT("width")),0,true) || !Number(Get(V,TEXT("height")),0,true)) return Fail(E,TEXT("viewport"),TEXT("invalid dimensions"));
        for (const TCHAR* K:{TEXT("assets"),TEXT("fonts"),TEXT("collections")}) if (!Array(Get(D,K))) return Fail(E,K,TEXT("expected array"));
        TSet<FString> Paths;
        for (const FVal& X:D->GetArrayField(TEXT("assets")))
        {
            FObj A=AsObject(X); if (!Keys(A,TEXT("id|path|kind|mime|sha256"),TEXT(""),E,TEXT("asset"))) return false;
            if (!String(Get(A,TEXT("id"))) || !String(Get(A,TEXT("path"))) || !String(Get(A,TEXT("mime")),false) || !String(Get(A,TEXT("sha256"))) || !OneOf(Get(A,TEXT("kind")),TEXT("image|font"))) return Fail(E,TEXT("asset"),TEXT("invalid fields"));
            FString Id=Str(A,TEXT("id")), Path=Str(A,TEXT("path"));
            if (Assets.Contains(Id) || Paths.Contains(Path.ToLower()) || !SafePath(Path) || !Match(Str(A,TEXT("sha256")),TEXT("^[0-9a-fA-F]{64}$"))) return Fail(E,Id,TEXT("duplicate id/path, unsafe relative path, or invalid SHA256"));
            Assets.Add(Id,A); Paths.Add(Path.ToLower());
            const FString Ext=FPaths::GetExtension(Path).ToLower(), Mime=Str(A,TEXT("mime"));
            if (Str(A,TEXT("kind"))==TEXT("font"))
            {
                if (Ext==TEXT("woff") || Ext==TEXT("woff2") || Mime.Contains(TEXT("woff"))) return Fail(E,Id,TEXT("WOFF/WOFF2 unsupported: UE font factory accepts sfnt fonts and bundled FreeType does not enable Brotli. Convert the licensed font to TTF/OTF, update @font-face, and rebuild the package (including hashes). No fallback font is substituted."));
                if (!((Ext==TEXT("ttf") && (Mime==TEXT("font/ttf") || Mime==TEXT("application/octet-stream"))) || (Ext==TEXT("otf") && (Mime==TEXT("font/otf") || Mime==TEXT("application/octet-stream"))))) return Fail(E,Id,TEXT("font must be a single-face TTF/OTF with matching MIME"));
            }
            else if (!((Ext==TEXT("png") && Mime==TEXT("image/png")) || ((Ext==TEXT("jpg") || Ext==TEXT("jpeg")) && Mime==TEXT("image/jpeg")))) return Fail(E,Id,TEXT("supported images are PNG/JPEG with matching MIME"));
        }
        for (const FVal& X:D->GetArrayField(TEXT("fonts")))
        {
            FObj F=AsObject(X); if (!Keys(F,TEXT("family|weight|assetId"),TEXT(""),E,TEXT("font"))) return false;
            if (!String(Get(F,TEXT("family"))) || !String(Get(F,TEXT("assetId"))) || !Number(Get(F,TEXT("weight"))) || (Num(F,TEXT("weight"))!=400 && Num(F,TEXT("weight"))!=700)) return Fail(E,TEXT("font"),TEXT("invalid fields"));
            FString K=FontKey(Str(F,TEXT("family")),int32(Num(F,TEXT("weight")))), A=Str(F,TEXT("assetId"));
            if (Fonts.Contains(K) || !Assets.Contains(A) || Str(Assets[A],TEXT("kind"))!=TEXT("font")) return Fail(E,TEXT("font"),TEXT("duplicate family/weight or invalid asset reference")); Fonts.Add(K);
        }
        if (!Node(AsObject(Get(D,TEXT("root"))),RootNodes,nullptr,false,0)) return false;
        const FObj RootBox=Obj(Obj(D,TEXT("root")),TEXT("box"));
        if (!Fixed(RootBox,TEXT("width")) || !Fixed(RootBox,TEXT("height")) || Num(V,TEXT("width"))>8192 || Num(V,TEXT("height"))>8192
            || Num(RootBox,TEXT("width"))!=Num(V,TEXT("width")) || Num(RootBox,TEXT("height"))!=Num(V,TEXT("height")))
            return Fail(E,TEXT("root/box"),TEXT("root must have fixed dimensions matching the viewport (maximum 8192 per axis)"));
        FObj TS=AsObject(Get(D,TEXT("templates"))), Observations=AsObject(Get(D,TEXT("observations")));
        if (!TS || !Observations) return Fail(E,TEXT("document"),TEXT("templates/observations must be objects"));
        for (auto& P:TS->Values) { if (P.Key.IsEmpty()) return Fail(E,TEXT("templates"),TEXT("empty id")); auto& Map=Templates.Add(P.Key); if (!Node(AsObject(P.Value),Map,nullptr,true,0)) return false; }
        TSet<FString> Actual, CollectionIds, Views, ItemKeys, UsedTemplates;
        for (auto& P:RootNodes) Actual.Add(P.Key);
        for (const FVal& X:D->GetArrayField(TEXT("collections")))
        {
            FObj C=AsObject(X); if (!Keys(C,TEXT("id|nodeId|templateId|orientation|items"),TEXT(""),E,TEXT("collection"))) return false;
            for (const TCHAR* K:{TEXT("id"),TEXT("nodeId"),TEXT("templateId")}) if (!String(Get(C,K))) return Fail(E,TEXT("collection"),TEXT("missing identifier"));
            if (!OneOf(Get(C,TEXT("orientation")),TEXT("horizontal|vertical")) || !Array(Get(C,TEXT("items")))) return Fail(E,TEXT("collection"),TEXT("invalid orientation/items"));
            FString Id=Str(C,TEXT("id")), View=Str(C,TEXT("nodeId")), T=Str(C,TEXT("templateId"));
            if (CollectionIds.Contains(Id) || Views.Contains(View) || !RootNodes.Contains(View) || !Templates.Contains(T)) return Fail(E,Id,TEXT("duplicate or unresolved collection reference"));
            FObj N=RootNodes[View]; if (Str(N,TEXT("kind"))!=TEXT("collection") || Str(N,TEXT("collectionId"))!=Id || Str(N,TEXT("layout"))!=(Str(C,TEXT("orientation"))==TEXT("horizontal")?TEXT("row"):TEXT("column"))) return Fail(E,Id,TEXT("collection view/id/orientation mismatch"));
            CollectionIds.Add(Id); Views.Add(View); UsedTemplates.Add(T); auto& TN=Templates[T];
            FObj TR=TS->GetObjectField(T);
            // Stock list row geometry is not CSS align-items. Restrict it rather than silently stretching fixed entries.
            FObj TB=Obj(TR,TEXT("box")); if (!Fixed(TB,TEXT("width")) || !Fixed(TB,TEXT("height")) || !Zero(Edges(TB,TEXT("margin")))) return Fail(E,Id,TEXT("list templates require fixed dimensions and zero root margin"));
            const FObj VB=Obj(N,TEXT("box")); const FMargin VP=Edges(VB,TEXT("padding"));
            const bool Horizontal=Str(C,TEXT("orientation"))==TEXT("horizontal"); const TCHAR* Cross=Horizontal?TEXT("height"):TEXT("width");
            if (!Fixed(VB,TEXT("width")) || !Fixed(VB,TEXT("height")) || FMath::Abs(Num(VB,Cross)-(Horizontal?VP.Top+VP.Bottom:VP.Left+VP.Right)-Num(TB,Cross))>.01)
                return Fail(E,Id,TEXT("stock ListView subset requires fixed viewport dimensions and template cross-size equal to the padded viewport cross-size"));
            const double MainAvailable=Num(VB,Horizontal?TEXT("width"):TEXT("height"))-(Horizontal?VP.Left+VP.Right:VP.Top+VP.Bottom);
            const int32 Count=C->GetArrayField(TEXT("items")).Num();
            const double MainRequired=Count*Num(TB,Horizontal?TEXT("width"):TEXT("height"))+FMath::Max(0,Count-1)*Num(VB,TEXT("gap"));
            if (Str(VB,TEXT("overflow"))==TEXT("visible") && MainRequired>MainAvailable+.01) return Fail(E,Id,TEXT("overflow-visible list exceeds viewport; stock ListView clips. Use overflow:clip or enlarge viewport"));
            if (Str(TB,TEXT("display"))!=TEXT("visible")) return Fail(E,Id,TEXT("collapsed list template unsupported"));
            for (const FVal& Y:C->GetArrayField(TEXT("items")))
            {
                FObj I=AsObject(Y); if (!Keys(I,TEXT("key|nodeIds|overrides"),TEXT(""),E,Id)) return false;
                FObj NI=AsObject(Get(I,TEXT("nodeIds"))), O=AsObject(Get(I,TEXT("overrides")));
                if (!String(Get(I,TEXT("key"))) || !NI || !O || NI->Values.Num()!=TN.Num()) return Fail(E,Id,TEXT("invalid item or incomplete nodeIds"));
                FString Key=Str(I,TEXT("key")); if (ItemKeys.Contains(Key)) return Fail(E,Id,TEXT("duplicate item key")); ItemKeys.Add(Key);
                FVal RootId=NI->TryGetField(Str(TR,TEXT("id"))); if (!String(RootId) || RootId->AsString()!=Key) return Fail(E,Id,TEXT("item key must equal mapped template root"));
                for (auto& P:NI->Values) { if (!TN.Contains(P.Key) || !String(P.Value) || Actual.Contains(P.Value->AsString())) return Fail(E,Id,TEXT("invalid/duplicate actual node id")); Actual.Add(P.Value->AsString()); }
                for (auto& P:O->Values)
                {
                    FObj OV=AsObject(P.Value); if (!TN.Contains(P.Key) || !Keys(OV,TEXT(""),TEXT("text|assetId|background|color"),E,Id+TEXT("/override"))) return Fail(E,Id,TEXT("invalid override target/fields"));
                    FString Kind=Str(TN[P.Key],TEXT("kind"));
                    if (OV->HasField(TEXT("text")) && (Kind!=TEXT("text") || !String(Get(OV,TEXT("text")),false))) return Fail(E,Id,TEXT("text override requires text target/string"));
                    if (OV->HasField(TEXT("assetId")) && (Kind!=TEXT("image") || !Image(Get(OV,TEXT("assetId")),Id))) return Fail(E,Id,TEXT("invalid image override"));
                    for (const TCHAR* K:{TEXT("background"),TEXT("color")}) if (OV->HasField(K) && !IsColor(Get(OV,K))) return Fail(E,Id,TEXT("invalid override color"));
                }
            }
        }
        if (UsedTemplates.Num()!=Templates.Num()) return Fail(E,TEXT("templates"),TEXT("orphan template"));
        for (auto& P:RootNodes) if (Str(P.Value,TEXT("kind"))==TEXT("collection") && !Views.Contains(P.Key)) return Fail(E,P.Key,TEXT("collection has no definition"));
        if (Observations->Values.Num()!=Actual.Num()) return Fail(E,TEXT("observations"),TEXT("must cover exactly root and instantiated node IDs"));
        for (auto& P:Observations->Values)
        {
            FObj R=AsObject(P.Value); if (!Actual.Contains(P.Key) || !Keys(R,TEXT("x|y|width|height"),TEXT(""),E,TEXT("observation"))) return Fail(E,P.Key,TEXT("unexpected/invalid observation"));
            if (!Number(Get(R,TEXT("x"))) || !Number(Get(R,TEXT("y"))) || !Number(Get(R,TEXT("width")),0) || !Number(Get(R,TEXT("height")),0)) return Fail(E,P.Key,TEXT("invalid observation rect"));
        }
        return true;
    }
};

// Portable SHA-256: GenericPlatformMisc's default implementation asserts on some editor platforms.
static FString Sha256(const TArray<uint8>& Input)
{
    static const uint32 K[64]={0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
    uint32 H[8]={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    TArray<uint8> Data=Input; Data.Add(0x80); while (Data.Num()%64!=56) Data.Add(0);
    uint64 Bits=uint64(Input.Num())*8; for (int32 I=7;I>=0;--I) Data.Add(uint8(Bits>>(I*8)));
    auto R=[](uint32 X,int N){return (X>>N)|(X<<(32-N));};
    for (int32 Offset=0;Offset<Data.Num();Offset+=64)
    {
        uint32 W[64]; for (int I=0;I<16;++I) {const uint8* P=Data.GetData()+Offset+I*4; W[I]=(uint32(P[0])<<24)|(uint32(P[1])<<16)|(uint32(P[2])<<8)|P[3];}
        for (int I=16;I<64;++I) W[I]=W[I-16]+(R(W[I-15],7)^R(W[I-15],18)^(W[I-15]>>3))+W[I-7]+(R(W[I-2],17)^R(W[I-2],19)^(W[I-2]>>10));
        uint32 A=H[0],B=H[1],C=H[2],D=H[3],E=H[4],F=H[5],G=H[6],J=H[7];
        for (int I=0;I<64;++I) {uint32 T1=J+(R(E,6)^R(E,11)^R(E,25))+((E&F)^(~E&G))+K[I]+W[I];uint32 T2=(R(A,2)^R(A,13)^R(A,22))+((A&B)^(A&C)^(B&C));J=G;G=F;F=E;E=D+T1;D=C;C=B;B=A;A=T1+T2;}
        H[0]+=A;H[1]+=B;H[2]+=C;H[3]+=D;H[4]+=E;H[5]+=F;H[6]+=G;H[7]+=J;
    }
    FString Result; for (uint32 X:H) Result+=FString::Printf(TEXT("%08x"),X); return Result;
}
struct FPackageData { FObj Document; TMap<FString,TArray<uint8>> Bytes; TMap<FString,FString> Files; };
static bool NoSymlinks(const FString& Path, FString& E)
{
    FString Current=FPaths::ConvertRelativePathToFull(Path); FPaths::NormalizeFilename(Current);
    IPlatformFile& Platform=FPlatformFileManager::Get().GetPlatformFile();
    while (!Current.IsEmpty())
    {
        const ESymlinkResult R=Platform.IsSymlink(*Current);
        if (R!=ESymlinkResult::NonSymlink) return Fail(E,Current,TEXT("symlink/reparse-point paths (or platforms unable to check them) are not accepted"));
        FString Parent=FPaths::GetPath(Current); if (Parent==Current) break; Current=Parent;
    }
    return true;
}
static bool Load(const FString& Input,FPackageData& Out,FString& E)
{
    E.Reset(); FString File=FPaths::ConvertRelativePathToFull(Input);
    if (IFileManager::Get().DirectoryExists(*File)) File=FPaths::Combine(File,TEXT("ui.ir.json"));
    if (!NoSymlinks(File,E)) return false;
    int64 Size=IFileManager::Get().FileSize(*File); if (Size<=0 || Size>16*1024*1024) return Fail(E,File,TEXT("IR missing/empty or exceeds 16 MiB"));
    FString Json; if (!FFileHelper::LoadFileToString(Json,*File)) return Fail(E,File,TEXT("cannot read JSON"));
    // UE's object deserializer otherwise overwrites duplicate keys. Reject those and bound parser depth first.
    auto Reader=TJsonReaderFactory<>::Create(Json); EJsonNotation Notation; TArray<TSet<FString>> Seen; TArray<bool> IsObject;
    while (Reader->ReadNext(Notation))
    {
        if (Notation==EJsonNotation::Error) return Fail(E,File,TEXT("malformed JSON"));
        const bool End=Notation==EJsonNotation::ObjectEnd || Notation==EJsonNotation::ArrayEnd;
        if (End) {if (!Seen.IsEmpty()) {Seen.Pop();IsObject.Pop();} continue;}
        if (!Seen.IsEmpty() && IsObject.Last()) {const FString Key=Reader->GetIdentifier(); if (Seen.Last().Contains(Key)) return Fail(E,File,TEXT("duplicate JSON key: ")+Key); Seen.Last().Add(Key);}
        if (Notation==EJsonNotation::ObjectStart || Notation==EJsonNotation::ArrayStart) {Seen.AddDefaulted();IsObject.Add(Notation==EJsonNotation::ObjectStart); if (Seen.Num()>512) return Fail(E,File,TEXT("JSON nesting exceeds 512"));}
    }
    if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json),Out.Document)) return Fail(E,File,TEXT("invalid JSON object"));
    if (!FImg2UmgV2Importer::ValidateDocument(Out.Document,E)) return false;
    FString Base=FPaths::GetPath(File); int64 Total=0;
    for (const FVal& V:Out.Document->GetArrayField(TEXT("assets")))
    {
        FObj A=V->AsObject(); FString Id=Str(A,TEXT("id")), Path=FPaths::Combine(Base,Str(A,TEXT("path")));
        if (!NoSymlinks(Path,E)) return false;
        int64 N=IFileManager::Get().FileSize(*Path); Total+=FMath::Max<int64>(N,0);
        if (N<=0 || N>64*1024*1024 || Total>256*1024*1024) return Fail(E,Path,TEXT("missing/empty asset or 64 MiB asset / 256 MiB package limit exceeded"));
        TArray<uint8>& Bytes=Out.Bytes.Add(Id); if (!FFileHelper::LoadFileToArray(Bytes,*Path)) return Fail(E,Path,TEXT("cannot read asset"));
        if (!Sha256(Bytes).Equals(Str(A,TEXT("sha256")),ESearchCase::IgnoreCase)) return Fail(E,Path,TEXT("SHA256 mismatch; rebuild the package"));
        const FString Ext=FPaths::GetExtension(Path).ToLower();
        bool Magic=false;
        if (Ext==TEXT("png")) { const uint8 Header[]={137,80,78,71,13,10,26,10}; Magic=Bytes.Num()>=24 && FMemory::Memcmp(Bytes.GetData(),Header,8)==0; }
        else if (Ext==TEXT("jpg") || Ext==TEXT("jpeg")) Magic=Bytes.Num()>=4 && Bytes[0]==255 && Bytes[1]==216 && Bytes[2]==255;
        else Magic=Bytes.Num()>=12 && ((Bytes[0]==0 && Bytes[1]==1 && Bytes[2]==0 && Bytes[3]==0) || FMemory::Memcmp(Bytes.GetData(),"OTTO",4)==0);
        if (!Magic) return Fail(E,Path,TEXT("asset signature does not match a supported image/sfnt font"));
        if (Str(A,TEXT("kind"))==TEXT("image"))
        {
            IImageWrapperModule& Module=FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
            TSharedPtr<IImageWrapper> Wrapper=Module.CreateImageWrapper(Ext==TEXT("png")?EImageFormat::PNG:EImageFormat::JPEG);
            if (!Wrapper || !Wrapper->SetCompressed(Bytes.GetData(),Bytes.Num()) || Wrapper->GetWidth()<=0 || Wrapper->GetHeight()<=0 || Wrapper->GetWidth()>8192 || Wrapper->GetHeight()>8192 || Wrapper->GetWidth()*Wrapper->GetHeight()>16777216)
                return Fail(E,Path,TEXT("invalid image or dimensions exceed 8192/16 megapixels"));
            TArray64<uint8> Raw; if (!Wrapper->GetRaw(Raw)) return Fail(E,Path,TEXT("image decode failed during preflight"));
        }
        else
        {
            auto U16=[&Bytes](int32 O){return (uint32(Bytes[O])<<8)|Bytes[O+1];};
            auto U32=[&Bytes](int32 O){return (uint32(Bytes[O])<<24)|(uint32(Bytes[O+1])<<16)|(uint32(Bytes[O+2])<<8)|Bytes[O+3];};
            const uint32 Tables=U16(4); if (!Tables || Tables>4096 || 12+uint64(Tables)*16>uint64(Bytes.Num())) return Fail(E,Path,TEXT("invalid sfnt table directory"));
            TSet<uint32> Tags;
            for (uint32 I=0;I<Tables;++I)
            {
                const int32 O=12+I*16; const uint32 Tag=U32(O), Offset=U32(O+8), Length=U32(O+12);
                if (Tags.Contains(Tag) || uint64(Offset)+Length>uint64(Bytes.Num())) return Fail(E,Path,TEXT("duplicate/out-of-bounds sfnt table")); Tags.Add(Tag);
            }
            if (!Tags.Contains(0x636d6170) || !Tags.Contains(0x68656164) || !Tags.Contains(0x6d617870) || !Tags.Contains(0x68686561) || !Tags.Contains(0x686d7478)) return Fail(E,Path,TEXT("font lacks required cmap/head/maxp/hhea/hmtx tables"));
        }
        Out.Files.Add(Id,Path);
    }
    return true;
}
} // namespace Img2UmgV2

bool FImg2UmgV2Importer::ValidateDocument(const TSharedPtr<FJsonObject>& Document,FString& OutError)
{
    OutError.Reset(); Img2UmgV2::FValidator Validator{OutError}; return Validator.Run(Document);
}
bool FImg2UmgV2Importer::ValidatePackage(const FString& FilePath,FString& OutError)
{
    Img2UmgV2::FPackageData Data; return Img2UmgV2::Load(FilePath,Data,OutError);
}

namespace Img2UmgV2
{
static EHorizontalAlignment HAlign(const FString& A) { return A==TEXT("center")?HAlign_Center:A==TEXT("flex-end")?HAlign_Right:A==TEXT("stretch")?HAlign_Fill:HAlign_Left; }
static EVerticalAlignment VAlign(const FString& A) { return A==TEXT("center")?VAlign_Center:A==TEXT("flex-end")?VAlign_Bottom:A==TEXT("stretch")?VAlign_Fill:VAlign_Top; }
struct FBuilder
{
    FPackageData& Data;
    FString Path;
    FString& Error;
    TMap<FString,UTexture2D*> Images;
    TMap<FString,UFont*> Fonts;
    TMap<FString,UWidgetBlueprint*> Entries;
    TArray<UObject*> Created;
    TArray<FImg2UmgFieldBinding> Bindings;
    TMap<FString,FName> NodeNames;
    int32 Serial=0;
    template<class T> T* Widget(UWidgetTree* Tree,const TCHAR* Prefix) { return Tree->ConstructWidget<T>(T::StaticClass(),FName(*FString::Printf(TEXT("%s_%d"),Prefix,++Serial))); }
    UPackage* Package(const FString& Name) { return CreatePackage(*(Path+TEXT("/")+Name)); }
    bool Save(UObject* Asset)
    {
        FSavePackageArgs Args; Args.TopLevelFlags=RF_Public|RF_Standalone; Args.SaveFlags=SAVE_NoError;
        UPackage* P=Asset->GetOutermost(); P->MarkPackageDirty();
        FString File=FPackageName::LongPackageNameToFilename(P->GetName(),FPackageName::GetAssetPackageExtension());
        if (!UPackage::SavePackage(P,Asset,*File,Args)) return Fail(Error,P->GetName(),TEXT("save failed; this import may have partial output"));
        FAssetRegistryModule::AssetCreated(Asset); return true;
    }
    bool ImportAssets()
    {
        int32 Index=0; TMap<FString,UFont*> FontAssets;
        for (const FVal& V:Data.Document->GetArrayField(TEXT("assets")))
        {
            FObj A=V->AsObject(); FString Id=Str(A,TEXT("id")), Ext=FPaths::GetExtension(Data.Files[Id]);
            FString Name=FString::Printf(TEXT("Asset_%d"),++Index); const auto& Bytes=Data.Bytes[Id]; const uint8* Start=Bytes.GetData(); UObject* Asset=nullptr;
            if (Str(A,TEXT("kind"))==TEXT("image"))
            {
                UTextureFactory* Factory=NewObject<UTextureFactory>(); Factory->SuppressImportOverwriteDialog();
                Asset=Factory->FactoryCreateBinary(UTexture2D::StaticClass(),Package(Name),FName(*Name),RF_Public|RF_Standalone,nullptr,*Ext,Start,Start+Bytes.Num(),GWarn);
                UTexture2D* Texture=Cast<UTexture2D>(Asset); if (!Texture) return Fail(Error,Id,TEXT("texture decoding/import failed"));
                Texture->LODGroup=TEXTUREGROUP_UI; Texture->SRGB=true; Texture->NeverStream=true; Texture->CompressionSettings=TC_EditorIcon; Texture->PostEditChange(); Images.Add(Id,Texture);
            }
            else
            {
                UFontFileImportFactory* Factory=NewObject<UFontFileImportFactory>(); Factory->BatchCreateFontAsset=EBatchCreateFontAsset::No;
                Asset=Factory->FactoryCreateBinary(UFontFace::StaticClass(),Package(Name),FName(*Name),RF_Public|RF_Standalone,nullptr,*Ext,Start,Start+Bytes.Num(),GWarn);
                UFontFace* Face=Cast<UFontFace>(Asset); if (!Face) return Fail(Error,Id,TEXT("font import failed"));
                Face->LoadingPolicy=EFontLoadingPolicy::Inline;
                FString FontName=Name+TEXT("_Font"); UFont* Font=NewObject<UFont>(Package(FontName),FName(*FontName),RF_Public|RF_Standalone);
                Font->FontCacheType=EFontCacheType::Runtime;
                FTypefaceEntry& Entry=Font->GetMutableInternalCompositeFont().DefaultTypeface.Fonts.AddDefaulted_GetRef(); Entry.Name=TEXT("Default"); Entry.Font=FFontData(Face);
                FontAssets.Add(Id,Font); Created.Add(Font);
            }
            Created.Add(Asset);
        }
        for (const FVal& V:Data.Document->GetArrayField(TEXT("fonts"))) {FObj F=V->AsObject(); Fonts.Add(FontKey(Str(F,TEXT("family")),int32(Num(F,TEXT("weight")))),FontAssets[Str(F,TEXT("assetId"))]);}
        return true;
    }
    FImg2UmgFieldValue Values(const FObj& O,bool Override)
    {
        FImg2UmgFieldValue V;
        FObj Paint=Override?O:Obj(O,TEXT("paint"));
        V.bHasBackground=Paint->HasField(TEXT("background")); if (V.bHasBackground) V.Background=ReadColor(Paint,TEXT("background"));
        V.bHasColor=Paint->HasField(TEXT("color")); if (V.bHasColor) V.Color=ReadColor(Paint,TEXT("color"));
        if (Override) {V.bHasText=O->HasField(TEXT("text")); if (V.bHasText) V.Text=FText::FromString(Str(O,TEXT("text")));}
        else {V.bHasText=Str(O,TEXT("kind"))==TEXT("text"); if (V.bHasText) V.Text=FText::FromString(Str(Obj(O,TEXT("text")),TEXT("value")));}
        V.bHasImage=O->HasField(TEXT("assetId")); if (V.bHasImage) V.Image=Images[Str(O,TEXT("assetId"))];
        return V;
    }
    UWidget* Build(UWidgetTree* Tree,const FObj& N)
    {
        FObj B=Obj(N,TEXT("box")), Paint=Obj(N,TEXT("paint")); const FString Kind=Str(N,TEXT("kind")), Layout=Str(N,TEXT("layout"));
        UWidget* Content=nullptr;
        if (Kind==TEXT("text"))
        {
            UTextBlock* Text=Widget<UTextBlock>(Tree,TEXT("Text")); FObj T=Obj(N,TEXT("text")); Text->SetText(FText::FromString(Str(T,TEXT("value"))));
            FSlateFontInfo Font(Fonts[FontKey(Str(T,TEXT("family")),int32(Num(T,TEXT("weight"))))],Num(T,TEXT("size"))*.75,TEXT("Default")); Text->SetFont(Font);
            Text->SetColorAndOpacity(FSlateColor(ReadColor(Paint,TEXT("color")))); Text->SetAutoWrapText(false);
            FString A=Str(T,TEXT("align")); Text->SetJustification(A==TEXT("center")?ETextJustify::Center:A==TEXT("right")?ETextJustify::Right:ETextJustify::Left); Content=Text;
        }
        else if (Kind==TEXT("image")) {UImage* Image=Widget<UImage>(Tree,TEXT("Image")); Image->SetBrushFromTexture(Images[Str(N,TEXT("assetId"))],false); Content=Image;}
        else if (Kind==TEXT("collection"))
        {
            FObj Definition; for (auto& C:Data.Document->GetArrayField(TEXT("collections"))) if (Str(C->AsObject(),TEXT("id"))==Str(N,TEXT("collectionId"))) Definition=C->AsObject();
            UImg2UmgListView* List=Widget<UImg2UmgListView>(Tree,TEXT("List"));
            if (!List->Configure(Entries[Str(Definition,TEXT("templateId"))]->GeneratedClass,Str(Definition,TEXT("orientation"))==TEXT("horizontal")?Orient_Horizontal:Orient_Vertical,Num(B,TEXT("gap")))) {Fail(Error,Str(N,TEXT("id")),TEXT("runtime list configuration failed")); return nullptr;}
            List->SetScrollbarVisibility(ESlateVisibility::Collapsed); List->SetSelectionMode(ESelectionMode::None); Content=List;
        }
        else
        {
            UPanelWidget* Panel=nullptr;
            if (Layout==TEXT("canvas")) Panel=Widget<UCanvasPanel>(Tree,TEXT("Canvas"));
            else if (Layout==TEXT("column")) Panel=Widget<UVerticalBox>(Tree,TEXT("Column"));
            else Panel=Widget<UHorizontalBox>(Tree,TEXT("Row"));
            bool PreviousVisible=false;
            for (const FVal& V:N->GetArrayField(TEXT("children")))
            {
                FObj Child=V->AsObject(), CB=Obj(Child,TEXT("box")); bool Visible=Str(CB,TEXT("display"))!=TEXT("collapsed");
                if (Visible && PreviousVisible && Layout!=TEXT("canvas") && Num(B,TEXT("gap"))>0)
                {
                    USpacer* Gap=Widget<USpacer>(Tree,TEXT("Gap")); Gap->SetSize(Layout==TEXT("column")?FVector2D(0,Num(B,TEXT("gap"))):FVector2D(Num(B,TEXT("gap")),0)); Panel->AddChild(Gap);
                }
                if (Visible) PreviousVisible=true;
                UWidget* W=Build(Tree,Child); if (!W) return nullptr;
                UPanelSlot* Slot=Panel->AddChild(W); FMargin Margin=Edges(CB,TEXT("margin")); FString Align=Str(CB,TEXT("self")); if (Align==TEXT("auto")) Align=Str(B,TEXT("align"));
                // CSS stretch only stretches auto cross-axis dimensions, never explicit dimensions.
                if (Align==TEXT("stretch") && Fixed(CB,Layout==TEXT("column")?TEXT("width"):TEXT("height"))) Align=TEXT("flex-start");
                if (auto S=Cast<UHorizontalBoxSlot>(Slot)) {S->SetPadding(Margin); S->SetSize(FSlateChildSize(ESlateSizeRule::Automatic)); S->SetHorizontalAlignment(HAlign_Fill); S->SetVerticalAlignment(VAlign(Align));}
                if (auto S=Cast<UVerticalBoxSlot>(Slot)) {S->SetPadding(Margin); S->SetSize(FSlateChildSize(ESlateSizeRule::Automatic)); S->SetHorizontalAlignment(HAlign(Align)); S->SetVerticalAlignment(VAlign_Fill);}
                if (auto S=Cast<UCanvasPanelSlot>(Slot)) {S->SetAnchors(FAnchors(0,0)); S->SetAlignment(FVector2D::ZeroVector); S->SetAutoSize(false); S->SetPosition(FVector2D(Num(CB,TEXT("left")),Num(CB,TEXT("top")))); S->SetSize(FVector2D(Num(CB,TEXT("width")),Num(CB,TEXT("height")))); S->SetZOrder(int32(Num(CB,TEXT("zIndex"))));}
            }
            Content=Panel;
            if (Kind==TEXT("button"))
            {
                UButton* Button=Widget<UButton>(Tree,TEXT("Button")); FButtonStyle Style;
                FSlateBrush Clear; Clear.DrawAs=ESlateBrushDrawType::NoDrawType; Style.Normal=Clear;Style.Hovered=Clear;Style.Pressed=Clear;Style.Disabled=Clear;Style.NormalPadding=FMargin(0);Style.PressedPadding=FMargin(0);
                Button->SetStyle(Style); Button->SetContent(Panel);
                UButtonSlot* ButtonSlot=CastChecked<UButtonSlot>(Panel->Slot); ButtonSlot->SetPadding(FMargin(0)); ButtonSlot->SetHorizontalAlignment(HAlign_Fill); ButtonSlot->SetVerticalAlignment(VAlign_Fill); Content=Button;
            }
        }
        UBorder* Background=Widget<UBorder>(Tree,TEXT("Background")); Background->SetPadding(Edges(B,TEXT("padding"))); Background->SetHorizontalAlignment(HAlign_Fill); Background->SetVerticalAlignment(VAlign_Fill);
        FSlateBrush Brush; Brush.DrawAs=ESlateBrushDrawType::Image; Brush.TintColor=FSlateColor(FLinearColor::White); Background->SetBrush(Brush); Background->SetBrushColor(ReadColor(Paint,TEXT("background"))); Background->SetContent(Content);
        USizeBox* Box=Widget<USizeBox>(Tree,TEXT("Box")); if (Fixed(B,TEXT("width"))) Box->SetWidthOverride(Num(B,TEXT("width"))); if (Fixed(B,TEXT("height"))) Box->SetHeightOverride(Num(B,TEXT("height"))); Box->SetContent(Background);
        Box->SetVisibility(Str(B,TEXT("display"))==TEXT("collapsed")?ESlateVisibility::Collapsed:Str(B,TEXT("visibility"))==TEXT("hidden")?ESlateVisibility::Hidden:ESlateVisibility::Visible);
        Box->SetClipping(Str(B,TEXT("overflow"))==TEXT("clip")?EWidgetClipping::ClipToBounds:EWidgetClipping::Inherit);
        FImg2UmgFieldBinding Binding; Binding.NodeId=FName(*Str(N,TEXT("id"))); Binding.WidgetName=Content->GetFName(); Binding.BackgroundWidgetName=Background->GetFName(); Binding.Defaults=Values(N,false); Bindings.Add(Binding); NodeNames.Add(Str(N,TEXT("id")),Content->GetFName());
        return Box;
    }
    UWidgetBlueprint* Blueprint(const FString& Name,const FObj& Root,bool Entry)
    {
        UWidgetBlueprintFactory* Factory=NewObject<UWidgetBlueprintFactory>(); Factory->ParentClass=Entry?UImg2UmgEntryWidget::StaticClass():UImg2UmgScreenWidget::StaticClass();
        UWidgetBlueprint* BP=Cast<UWidgetBlueprint>(Factory->FactoryCreateNew(UWidgetBlueprint::StaticClass(),Package(Name),FName(*Name),RF_Public|RF_Standalone,nullptr,GWarn));
        if (!BP) {Fail(Error,Name,TEXT("WidgetBlueprint factory failed")); return nullptr;}
        Created.Add(BP); Bindings.Reset(); NodeNames.Reset(); Serial=0;
        BP->WidgetTree->RootWidget=Build(BP->WidgetTree,Root); if (!BP->WidgetTree->RootWidget) return nullptr;
        if (!Entry)
        {
            // Do not let AddToViewport's fullscreen allocation stretch a fixed CSS root.
            USizeBox* RootBox=CastChecked<USizeBox>(BP->WidgetTree->RootWidget);
            if (!Fixed(Obj(Root,TEXT("box")),TEXT("width"))) RootBox->SetWidthOverride(Num(Obj(Data.Document,TEXT("viewport")),TEXT("width")));
            UCanvasPanel* Viewport=Widget<UCanvasPanel>(BP->WidgetTree,TEXT("Viewport")); UCanvasPanelSlot* RootSlot=Viewport->AddChildToCanvas(RootBox);
            RootSlot->SetAnchors(FAnchors(0,0));RootSlot->SetAlignment(FVector2D::ZeroVector);RootSlot->SetPosition(FVector2D::ZeroVector);RootSlot->SetAutoSize(true);BP->WidgetTree->RootWidget=Viewport;
        }
        FKismetEditorUtilities::CompileBlueprint(BP); if (BP->Status==BS_Error || !BP->GeneratedClass) {Fail(Error,Name,TEXT("WidgetBlueprint compilation reported an error")); return nullptr;}
        if (Entry) CastChecked<UImg2UmgEntryWidget>(BP->GeneratedClass->GetDefaultObject())->FieldBindings=Bindings;
        else
        {
            UImg2UmgScreenWidget* CDO=CastChecked<UImg2UmgScreenWidget>(BP->GeneratedClass->GetDefaultObject()); CDO->CollectionSamples.Reset();
            for (const FVal& V:Data.Document->GetArrayField(TEXT("collections")))
            {
                FObj C=V->AsObject(); FImg2UmgCollectionSample Sample; Sample.ListWidgetName=NodeNames[Str(C,TEXT("nodeId"))];
                for (const FVal& I:C->GetArrayField(TEXT("items")))
                {
                    FObj Item=I->AsObject(); FImg2UmgItemRecord Record; Record.Key=Str(Item,TEXT("key"));
                    for (auto& P:Obj(Item,TEXT("overrides"))->Values) Record.Overrides.Add(FName(*P.Key),Values(P.Value->AsObject(),true));
                    Sample.Items.Add(MoveTemp(Record));
                }
                CDO->CollectionSamples.Add(MoveTemp(Sample));
            }
            CDO->bPopulateSamplesOnInitialized=true;
        }
        BP->MarkPackageDirty(); return BP;
    }
    bool Run()
    {
        if (!ImportAssets()) return false;
        int32 I=0; for (auto& P:Obj(Data.Document,TEXT("templates"))->Values) {UWidgetBlueprint* Entry=Blueprint(FString::Printf(TEXT("WBP_Entry_%d"),++I),P.Value->AsObject(),true); if (!Entry) return false; Entries.Add(P.Key,Entry);}
        UWidgetBlueprint* Screen=Blueprint(TEXT("WBP_Screen"),Obj(Data.Document,TEXT("root")),false); if (!Screen) return false;
        // Saving happens only after the complete object graph exists. This is not a disk transaction.
        for (UObject* A:Created) if (!Save(A)) return false;
        return true;
    }
};
}

bool FImg2UmgV2Importer::ImportPackage(const FString& FilePath,FString& OutError)
{
    OutputPath.Reset(); Img2UmgV2::FPackageData Data;
    if (!Img2UmgV2::Load(FilePath,Data,OutError)) return false;
    // A unique namespace prevents overwriting authored assets and previous imports.
    OutputPath=TEXT("/Game/Img2UmgV2/Import_")+FGuid::NewGuid().ToString(EGuidFormats::Digits);
    Img2UmgV2::FBuilder Builder{Data,OutputPath,OutError};
    if (!Builder.Run()) {OutError+=TEXT("\nImport output (may be partial): ")+OutputPath; return false;}
    return true;
}
