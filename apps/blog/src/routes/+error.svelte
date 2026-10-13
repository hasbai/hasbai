<script lang="ts">
  import { ui, links } from "$lib/i18n";
  const t = ui();
  const link = links();
  import { page } from "$app/state";
  import { Button } from "@hasbai/ui/button";
</script>

<section class="reading empty">
  <span class="meta">{page.status}</span>
  <h1 class="serif text-3xl">{page.error?.message ?? t("页面暂时无法打开")}</h1>
  <div class="flex justify-center gap-3">
    <Button variant="outline" onclick={() => location.reload()}
      >{t("重试")}</Button
    ><Button href={link("/")}>{t("返回首页")}</Button>
  </div>
</section>
