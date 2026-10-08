const fs = require('fs');
let css = fs.readFileSync('style.css', 'utf8');

// Convertir vw a px (1vw = 19.2px)
css = css.replace(/([\d.]+)vw/g, (match, p1) => {
    return Math.round(parseFloat(p1) * 19.2) + 'px';
});

// Modificar .scoreboard para que tenga tamaño fijo y transform-origin
css = css.replace('.scoreboard {', '.scoreboard {\n    position: absolute;\n    top: 50%;\n    left: 50%;\n    width: 1920px;\n    height: 1080px;\n    transform: translate(-50%, -50%);\n    transform-origin: center center;');

fs.writeFileSync('style.css', css);
console.log('Conversión de unidades y base de escalado aplicada con éxito.');
