(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const tabs = [...document.querySelectorAll(".tab")];
  const modes = {
    camera: $("cameraMode"),
    manual: $("manualMode"),
    photo: $("photoMode")
  };
  const status = $("status");
  const video = $("video");
  const records = [];
  let reader = null;
  let cameraControls = null;
  let scanning = false;
  let busy = false;
  let lastReadCode = "";

  function setStatus(message) {
    status.textContent = message;
  }

  function normalizeCode(value) {
    return String(value || "").replace(/\s+/g, "").trim();
  }

  function isValidBarcode(code) {
    // GTIN/EAN/UPC barcodes contain digits; allow common lengths and
    // accept other numeric lengths up to 20 for less common product codes.
    return /^[0-9]{6,20}$/.test(code);
  }

  function switchMode(mode) {
    tabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    Object.entries(modes).forEach(([name, element]) => {
      element.classList.toggle("hidden", name !== mode);
    });
    if (mode !== "camera") stopCamera();
    setStatus("");
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => switchMode(tab.dataset.mode)));

  async function lookupProduct(rawCode) {
    const code = normalizeCode(rawCode);
    if (!isValidBarcode(code)) {
      setStatus("Código inválido. Digite ou leia um código numérico com 6 a 20 dígitos.");
      return;
    }
    if (busy) return;

    busy = true;
    lastReadCode = code;
    setStatus("Código identificado. Consultando o produto online...");
    $("resultBadge").textContent = "Consultando";

    try {
      const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
      const response = await fetch(url, {
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) throw new Error(`Erro HTTP ${response.status}`);
      const data = await response.json();
      const product = data && data.status === 1 ? data.product : null;

      if (product) {
        const name = product.product_name_pt || product.product_name ||
                     product.generic_name_pt || product.generic_name ||
                     "Produto sem nome cadastrado";
        renderProduct(code, name, product.brands, product.quantity, true);
        addRecord(code, name);
        setStatus("Produto encontrado na base Open Food Facts.");
        $("resultBadge").textContent = "Encontrado";
      } else {
        renderProduct(code, "Produto não encontrado na base consultada", "", "", false);
        addRecord(code, "Produto não encontrado");
        setStatus("O código foi lido e registrado, mas não há descrição cadastrada nessa base.");
        $("resultBadge").textContent = "Sem cadastro";
      }
    } catch (error) {
      renderProduct(code, "Não foi possível consultar a descrição neste momento.", "", "", false);
      addRecord(code, "Descrição indisponível");
      setStatus("O código foi lido e salvo na lista, mas a consulta online falhou. Confira a internet e tente novamente.");
      $("resultBadge").textContent = "Sem conexão";
    } finally {
      busy = false;
    }
  }

  function renderProduct(code, name, brand, quantity, found) {
    const box = $("productResult");
    box.classList.remove("empty");
    box.replaceChildren();

    const title = document.createElement("h3");
    title.textContent = name;
    const codeLine = document.createElement("p");
    codeLine.textContent = `Código de barras: ${code}`;
    box.append(title, codeLine);

    if (brand) {
      const line = document.createElement("p");
      line.textContent = `Marca: ${brand}`;
      box.append(line);
    }
    if (quantity) {
      const line = document.createElement("p");
      line.textContent = `Quantidade: ${quantity}`;
      box.append(line);
    }
    if (!found) {
      const note = document.createElement("p");
      note.textContent = "A consulta depende dos produtos cadastrados na base Open Food Facts.";
      box.append(note);
    }
  }

  function addRecord(code, name) {
    // Avoid duplicate rows while keeping the most recent product visible.
    if (records.some((item) => item.code === code)) return;

    const item = { code, name, date: new Date() };
    records.push(item);
    $("emptyRow")?.remove();

    const tr = document.createElement("tr");
    [code, name, item.date.toLocaleString("pt-BR")].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    });
    $("codeList").append(tr);
    $("exportButton").disabled = false;
  }

  $("manualForm").addEventListener("submit", (event) => {
    event.preventDefault();
    lookupProduct($("manualCode").value);
  });

  async function startCamera() {
    if (scanning) return;
    if (!window.ZXingBrowser || !window.ZXingBrowser.BrowserMultiFormatReader) {
      setStatus("A biblioteca de leitura não carregou. Confira a internet, recarregue a página e tente novamente.");
      return;
    }

    try {
      reader = new window.ZXingBrowser.BrowserMultiFormatReader();
      scanning = true;
      $("startCamera").disabled = true;
      $("stopCamera").disabled = false;
      setStatus("Solicitando permissão para usar a câmera...");

      cameraControls = await reader.decodeFromVideoDevice(
        undefined,
        video,
        (result, error) => {
          if (!scanning || !result || busy) return;
          const code = normalizeCode(result.getText());
          if (code && code !== lastReadCode) {
            stopCamera();
            lookupProduct(code);
          }
        }
      );

      if (scanning) {
        setStatus("Câmera ativa. Aponte para o código de barras e mantenha a embalagem firme.");
      }
    } catch (error) {
      stopCamera();
      const message = error && error.name === "NotAllowedError"
        ? "Permissão da câmera negada. Autorize o uso da câmera nas configurações do navegador."
        : "Não foi possível iniciar a câmera. Use HTTPS ou localhost e confira se ela está disponível.";
      setStatus(message);
    }
  }

  function stopCamera() {
    scanning = false;
    if (cameraControls && typeof cameraControls.stop === "function") {
      cameraControls.stop();
    }
    cameraControls = null;

    if (video.srcObject) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
    $("startCamera").disabled = false;
    $("stopCamera").disabled = true;
  }

  $("startCamera").addEventListener("click", startCamera);
  $("stopCamera").addEventListener("click", () => {
    stopCamera();
    setStatus("Câmera desligada.");
  });

  $("photoInput").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    $("photoStatus").textContent = "Analisando a foto...";
    try {
      if (!window.ZXingBrowser || !window.ZXingBrowser.BrowserMultiFormatReader) {
        throw new Error("A biblioteca de leitura não carregou. Confira a internet.");
      }

      const imageUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = async () => {
        try {
          const imageReader = new window.ZXingBrowser.BrowserMultiFormatReader();
          const result = await imageReader.decodeFromImageElement(image);
          const code = normalizeCode(result.getText());
          $("photoStatus").textContent = `Código identificado: ${code}`;
          await lookupProduct(code);
        } catch (error) {
          $("photoStatus").textContent = "Não consegui identificar o código. Tire outra foto, com boa luz, foco e o código inteiro visível.";
        } finally {
          URL.revokeObjectURL(imageUrl);
        }
      };

      image.onerror = () => {
        $("photoStatus").textContent = "Não foi possível abrir a imagem selecionada.";
        URL.revokeObjectURL(imageUrl);
      };
      image.src = imageUrl;
    } catch (error) {
      $("photoStatus").textContent = error.message;
    } finally {
      event.target.value = "";
    }
  });

  $("exportButton").addEventListener("click", () => {
    if (!records.length) return;

    const csvCell = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const lines = [
      ["codigo", "produto", "data_hora"].map(csvCell).join(";"),
      ...records.map((item) => [
        item.code,
        item.name,
        item.date.toLocaleString("pt-BR")
      ].map(csvCell).join(";"))
    ];

    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;"
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "codigos.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  });

  window.addEventListener("pagehide", stopCamera);
})();